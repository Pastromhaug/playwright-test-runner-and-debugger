import fs from "fs";

interface NetworkFilterOptions {
  filterHeaders: boolean;
  reducePrecision: boolean;
  removeAnalytics: boolean;
  removeBlobUrls: boolean;
  removeCloudAnalytics: boolean;
  removeContentHashes: boolean;
  removeHttpMetadata: boolean;
  removeLargeUploads: boolean;
  removeMapsApi: boolean;
  removeStaticAssets: boolean;
  removeThirdPartyWidgets: boolean;
  removeTimingDetails: boolean;
  simplifyCookies: boolean;
  simplifyVerboseFields: boolean;
  truncateResponseBodies: boolean;
}

interface NetworkFilterStats {
  keptRequests: number;
  removedByCategory: Record<string, number>;
  removedRequests: number;
  sizeAfter: number;
  sizeBefore: number;
  totalRequests: number;
}

interface NetworkTraceEntry {
  [key: string]: unknown;
  snapshot: {
    [key: string]: unknown;
    request: {
      [key: string]: unknown;
      headers: Array<{ name: string; value: string }>;
      method: string;
      url: string;
    };
    response: {
      [key: string]: unknown;
      content: {
        [key: string]: unknown;
        mimeType: string;
        size: number;
      };
      headers: Array<{ name: string; value: string }>;
      status: number;
    };
  };
  type: string;
}

export class NetworkTraceFilter {
  private stats: NetworkFilterStats = {
    keptRequests: 0,
    removedByCategory: {},
    removedRequests: 0,
    sizeAfter: 0,
    sizeBefore: 0,
    totalRequests: 0,
  };

  /**
   * Filter a network trace file
   */
  async filterNetworkTrace(
    inputPath: string,
    outputPath: string,
    options: NetworkFilterOptions
  ): Promise<NetworkFilterStats> {
    const inputContent = fs.readFileSync(inputPath, "utf-8");
    this.stats.sizeBefore = inputContent.length;

    const lines = inputContent.trim().split("\n");
    const filteredEntries: NetworkTraceEntry[] = [];

    this.stats.totalRequests = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const entry = JSON.parse(line) as NetworkTraceEntry;
        const filtered = this.filterEntry(entry, options);

        if (filtered) {
          filteredEntries.push(filtered);
        }
      } catch (error) {
        console.warn(`⚠️  JSON decode error on line ${i + 1}: ${error}`);
        // Keep malformed entries to avoid data loss
        filteredEntries.push({
          _error: String(error),
          _originalLine: line,
          snapshot: {
            request: { headers: [], method: "UNKNOWN", url: "MALFORMED" },
            response: {
              content: { mimeType: "", size: 0 },
              headers: [],
              status: 0,
            },
          },
          type: "malformed",
        });
      }
    }

    // Write filtered content
    const outputContent = filteredEntries
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    fs.writeFileSync(outputPath, outputContent);

    this.stats.sizeAfter = outputContent.length;

    return this.stats;
  }

  /**
   * Remove verbose timing and metadata
   */
  private cleanTimingData(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const cleaned = { ...snapshot };

    // Keep essential timing info
    if (
      cleaned.timings &&
      typeof cleaned.timings === "object" &&
      cleaned.timings !== null
    ) {
      const timings = cleaned.timings as Record<string, unknown>;
      const wait = typeof timings.wait === "number" ? timings.wait : 0;
      const receive = typeof timings.receive === "number" ? timings.receive : 0;

      cleaned.timings = {
        _removed: "Detailed timing breakdown removed",
        total: wait + receive,
      };
    }

    // Remove verbose metadata
    delete cleaned._frameref;
    delete cleaned._monotonicTime;
    delete cleaned.cache;
    delete cleaned._transferSize;
    delete cleaned._securityDetails;
    delete cleaned.serverIPAddress;
    delete cleaned._serverPort;

    return cleaned;
  }

  /**
   * Filter a single network trace entry
   */
  private filterEntry(
    entry: NetworkTraceEntry,
    options: NetworkFilterOptions
  ): NetworkTraceEntry | null {
    // Check if this request should be removed entirely
    const removalReason = this.shouldRemoveRequest(entry, options);
    if (removalReason) {
      this.updateRemovalStats(removalReason);
      return null;
    }

    // Keep this request but filter its content
    this.stats.keptRequests++;

    const filteredEntry = JSON.parse(
      JSON.stringify(entry)
    ) as NetworkTraceEntry;

    // Filter headers
    if (options.filterHeaders) {
      if (filteredEntry.snapshot.request?.headers) {
        filteredEntry.snapshot.request.headers = this.filterHeaders(
          filteredEntry.snapshot.request.headers,
          true
        );
      }
      if (filteredEntry.snapshot.response?.headers) {
        filteredEntry.snapshot.response.headers = this.filterHeaders(
          filteredEntry.snapshot.response.headers,
          false
        );
      }
    }

    // Remove timing details
    if (options.removeTimingDetails) {
      filteredEntry.snapshot = this.cleanTimingData(filteredEntry.snapshot);
    }

    // Truncate response bodies
    if (
      options.truncateResponseBodies &&
      filteredEntry.snapshot.response?.content
    ) {
      filteredEntry.snapshot.response.content = this.truncateResponseBody(
        filteredEntry.snapshot.response.content,
        filteredEntry.snapshot.response.status
      );
    }

    // New simplification options
    if (options.simplifyVerboseFields) {
      filteredEntry.snapshot = this.simplifyVerboseFields(
        filteredEntry.snapshot
      );
    }

    if (options.removeHttpMetadata) {
      filteredEntry.snapshot = this.removeHttpMetadata(filteredEntry.snapshot);
    }

    if (options.simplifyCookies) {
      filteredEntry.snapshot = this.simplifyCookies(filteredEntry.snapshot);
    }

    if (options.removeContentHashes) {
      filteredEntry.snapshot = this.removeContentHashes(filteredEntry.snapshot);
    }

    if (options.reducePrecision) {
      filteredEntry.snapshot = this.reducePrecision(filteredEntry.snapshot);
    }

    return filteredEntry;
  }

  /**
   * Filter headers to keep only essential ones for debugging
   */
  private filterHeaders(
    headers: Array<{ name: string; value: string }>,
    isRequest: boolean
  ): Array<{ name: string; value: string }> {
    const essentialRequestHeaders = [
      "authorization",
      "content-type",
      "accept",
      "x-csrf-token",
      "x-requested-with",
      "origin",
      "referer",
    ];

    const essentialResponseHeaders = [
      "content-type",
      "set-cookie",
      "location",
      "www-authenticate",
      "x-error",
      "x-error-message",
      "access-control-allow-origin",
    ];

    const essentialHeaders = isRequest
      ? essentialRequestHeaders
      : essentialResponseHeaders;

    return headers.filter((header) => {
      const name = header.name.toLowerCase();

      // Keep essential headers
      if (essentialHeaders.some((essential) => name.includes(essential))) {
        return true;
      }

      // Keep error-related headers
      if (name.includes("error") || name.includes("warning")) {
        return true;
      }

      // Keep auth cookies only
      if (name === "cookie" || name === "set-cookie") {
        const value = header.value.toLowerCase();
        return (
          value.includes("auth") ||
          value.includes("session") ||
          value.includes("csrf")
        );
      }

      return false;
    });
  }

  private reducePrecision(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const simplified = { ...snapshot };

    // Round timing values to reasonable precision
    if (simplified.time && typeof simplified.time === "number") {
      simplified.time = Math.round(simplified.time * 100) / 100; // 2 decimal places
    }

    if (simplified.timings && typeof simplified.timings === "object") {
      const timings = simplified.timings as Record<string, unknown>;
      Object.keys(timings).forEach((key) => {
        if (typeof timings[key] === "number") {
          timings[key] = Math.round((timings[key] as number) * 100) / 100;
        }
      });
    }

    return simplified;
  }

  private removeContentHashes(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const cleaned = { ...snapshot };

    // Remove SHA1 hashes and other content metadata not needed for debugging
    if (cleaned.response?.content) {
      const content = cleaned.response.content as Record<string, unknown>;
      delete content._sha1;
      // Remove compression info when it's 0 (no compression)
      if (content.compression === 0) {
        delete content.compression;
      }
    }

    if (cleaned.request?.postData) {
      const postData = cleaned.request.postData as Record<string, unknown>;
      delete postData._sha1;
    }

    return cleaned;
  }

  private removeHttpMetadata(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const cleaned = { ...snapshot };

    // Remove HTTP protocol details not essential for debugging
    if (cleaned.request) {
      if (cleaned.request.httpVersion === "HTTP/1.1") {
        delete cleaned.request.httpVersion;
      }
      // Remove size metadata that's not debugging-relevant
      delete cleaned.request.headersSize;
      delete cleaned.request.bodySize;
    }

    if (cleaned.response) {
      if (cleaned.response.httpVersion === "HTTP/1.1") {
        delete cleaned.response.httpVersion;
      }
      delete cleaned.response.headersSize;
      delete cleaned.response.bodySize;
      delete cleaned.response._transferSize;
    }

    return cleaned;
  }

  /**
   * Check if a request should be removed entirely based on URL patterns
   */
  private shouldRemoveRequest(
    entry: NetworkTraceEntry,
    options: NetworkFilterOptions
  ): null | string {
    const url = entry.snapshot?.request?.url || "";
    const urlLower = url.toLowerCase();

    // Analytics & Tracking
    if (options.removeAnalytics) {
      const analyticsPatterns = [
        "px.ads.linkedin.com",
        "snap.licdn.com",
        "linkedin.com/px",
        "facebook.com",
        "connect.facebook.net",
        "fb.com",
        "googletagmanager.com",
        "google-analytics.com",
        "analytics.google.com",
        "google.com/analytics",
        "doubleclick.net",
        "sentry.io",
        "browser.sentry-cdn.com",
        "sentry-cdn.com",
      ];

      if (analyticsPatterns.some((pattern) => urlLower.includes(pattern))) {
        return "analytics";
      }
    }

    // Cloud Analytics & User Tracking
    if (options.removeCloudAnalytics) {
      const cloudAnalyticsPatterns = [
        "user-events-v3.s3-accelerate.amazonaws.com",
        "cognito-identity.us-west-2.amazonaws.com",
        "google.com/pagead",
        "googleadservices.com",
        "googlesyndication.com",
      ];

      if (
        cloudAnalyticsPatterns.some((pattern) => urlLower.includes(pattern))
      ) {
        return "cloud-analytics";
      }
    }

    // Maps API (might be app feature but often bloat)
    if (options.removeMapsApi) {
      const mapsPatterns = [
        "maps.googleapis.com",
        "maps.google.com",
        "earth.google.com",
      ];

      if (mapsPatterns.some((pattern) => urlLower.includes(pattern))) {
        return "maps-api";
      }
    }

    // Blob URLs (temporary file references)
    if (options.removeBlobUrls) {
      if (url.startsWith("blob:")) {
        return "blob-url";
      }
    }

    // Large file uploads (often not essential for debugging)
    if (options.removeLargeUploads) {
      const bodySize = entry.snapshot?.request?.bodySize;
      if (typeof bodySize === "number" && bodySize > 100000) {
        // > 100KB
        return "large-upload";
      }
    }

    // Static Assets
    if (options.removeStaticAssets) {
      // Font and CSS CDNs
      const staticCdnPatterns = [
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "use.fontawesome.com",
        "cdnjs.cloudflare.com",
        "cdn.jsdelivr.net",
        "unpkg.com",
      ];

      if (staticCdnPatterns.some((pattern) => urlLower.includes(pattern))) {
        return "static-cdn";
      }

      // File extensions for static assets
      const staticExtensions = [
        ".css",
        ".js",
        ".woff",
        ".woff2",
        ".ttf",
        ".eot",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".ico",
        ".mp4",
        ".webm",
        ".mp3",
        ".wav",
      ];

      // Remove query params for extension check
      const urlPath = url.split("?")[0];
      if (staticExtensions.some((ext) => urlPath.endsWith(ext))) {
        return "static-asset";
      }
    }

    // Third-party Widgets
    if (options.removeThirdPartyWidgets) {
      const widgetPatterns = [
        "intercom.io",
        "js.intercomcdn.com",
        "widget.intercom.io",
        "snippet.meticulous.ai",
        "hotjar.com",
        "zendesk.com",
        "drift.com",
        "crisp.chat",
        "tawk.to",
      ];

      if (widgetPatterns.some((pattern) => urlLower.includes(pattern))) {
        return "third-party-widget";
      }
    }

    return null; // Keep this request
  }

  private simplifyCookies(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const simplified = { ...snapshot };

    // Simplify cookies by removing verbose attributes when they're standard
    if (
      simplified.request?.cookies &&
      Array.isArray(simplified.request.cookies)
    ) {
      simplified.request.cookies = simplified.request.cookies.map(
        (cookie: unknown) => {
          const cookieObj = cookie as Record<string, unknown>;
          const simplifiedCookie: Record<string, unknown> = {
            name: cookieObj.name,
            value: cookieObj.value,
          };
          // Only include non-standard attributes
          if (cookieObj.path && cookieObj.path !== "/")
            simplifiedCookie.path = cookieObj.path;
          if (cookieObj.httpOnly)
            simplifiedCookie.httpOnly = cookieObj.httpOnly;
          if (cookieObj.sameSite && cookieObj.sameSite !== "Lax")
            simplifiedCookie.sameSite = cookieObj.sameSite;
          return simplifiedCookie;
        }
      );
    }

    if (
      simplified.response?.cookies &&
      Array.isArray(simplified.response.cookies)
    ) {
      simplified.response.cookies = simplified.response.cookies.map(
        (cookie: unknown) => {
          const cookieObj = cookie as Record<string, unknown>;
          const simplifiedCookie: Record<string, unknown> = {
            name: cookieObj.name,
            value: cookieObj.value,
          };
          if (cookieObj.path && cookieObj.path !== "/")
            simplifiedCookie.path = cookieObj.path;
          if (cookieObj.httpOnly)
            simplifiedCookie.httpOnly = cookieObj.httpOnly;
          if (cookieObj.sameSite && cookieObj.sameSite !== "Lax")
            simplifiedCookie.sameSite = cookieObj.sameSite;
          return simplifiedCookie;
        }
      );
    }

    return simplified;
  }

  private simplifyVerboseFields(
    snapshot: NetworkTraceEntry["snapshot"]
  ): NetworkTraceEntry["snapshot"] {
    const simplified = { ...snapshot };

    // Remove empty arrays and common repeated values
    if (simplified.request) {
      const queryString = simplified.request.queryString as unknown[];
      if (
        queryString &&
        Array.isArray(queryString) &&
        queryString.length === 0
      ) {
        delete simplified.request.queryString;
      }
      // Simplify common headers to avoid repetition
      if (simplified.request.headers) {
        simplified.request.headers = simplified.request.headers.filter(
          (header) => {
            // Keep essential headers, remove verbose repetitive ones
            const name = header.name.toLowerCase();
            return (
              !["accept-encoding", "accept-language"].includes(name) ||
              (header.value !== "gzip, deflate, br, zstd" &&
                header.value !== "en-US")
            );
          }
        );
      }
    }

    if (simplified.response) {
      // Remove empty redirectURL
      if (simplified.response.redirectURL === "") {
        delete simplified.response.redirectURL;
      }
      // Remove statusText when it's just "OK"
      if (simplified.response.statusText === "OK") {
        delete simplified.response.statusText;
      }
    }

    return simplified;
  }

  /**
   * Truncate response body for successful requests to reduce size
   */
  private truncateResponseBody(
    content: NetworkTraceEntry["snapshot"]["response"]["content"],
    status: number
  ): NetworkTraceEntry["snapshot"]["response"]["content"] {
    // Keep full body for error responses
    if (status >= 400) {
      return content;
    }

    // Keep full body for small responses
    if (content.size && content.size < 1000) {
      return content;
    }

    // For large successful responses, indicate truncation
    return {
      ...content,
      _note: "Response body truncated for successful request",
      _originalSize: content.size,
      _truncated: true,
    };
  }

  /**
   * Update removal statistics
   */
  private updateRemovalStats(category: string): void {
    this.stats.removedRequests++;
    this.stats.removedByCategory[category] =
      (this.stats.removedByCategory[category] || 0) + 1;
  }
}

/**
 * Filter network trace with preset configurations
 */
export async function filterNetworkTraceWithPreset(
  inputPath: string,
  outputPath: string,
  preset: "conservative" | "minimal" | "moderate" = "minimal"
): Promise<NetworkFilterStats> {
  const filter = new NetworkTraceFilter();

  const presets: Record<string, NetworkFilterOptions> = {
    conservative: {
      filterHeaders: true,
      reducePrecision: false,
      removeAnalytics: true,
      removeBlobUrls: false,
      removeCloudAnalytics: false,
      removeContentHashes: false,
      removeHttpMetadata: false,
      removeLargeUploads: false,
      removeMapsApi: false,
      removeStaticAssets: false,
      removeThirdPartyWidgets: false,
      removeTimingDetails: false,
      simplifyCookies: false,
      simplifyVerboseFields: false,
      truncateResponseBodies: false,
    },
    minimal: {
      filterHeaders: true,
      reducePrecision: true,
      removeAnalytics: true,
      removeBlobUrls: true,
      removeCloudAnalytics: true,
      removeContentHashes: true,
      removeHttpMetadata: true,
      removeLargeUploads: true,
      removeMapsApi: true,
      removeStaticAssets: true,
      removeThirdPartyWidgets: true,
      removeTimingDetails: true,
      simplifyCookies: true,
      simplifyVerboseFields: true,
      truncateResponseBodies: true,
    },
    moderate: {
      filterHeaders: true,
      reducePrecision: false,
      removeAnalytics: true,
      removeBlobUrls: true,
      removeCloudAnalytics: true,
      removeContentHashes: false,
      removeHttpMetadata: false,
      removeLargeUploads: false,
      removeMapsApi: false,
      removeStaticAssets: true,
      removeThirdPartyWidgets: true,
      removeTimingDetails: false,
      simplifyCookies: false,
      simplifyVerboseFields: false,
      truncateResponseBodies: true,
    },
  };

  return filter.filterNetworkTrace(inputPath, outputPath, presets[preset]);
}
