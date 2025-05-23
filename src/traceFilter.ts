import fs from "fs";

interface FilterOptions {
  filterConsoleLogs: boolean;
  removeFrameSnapshots: boolean;
  removeScreencastFrames: boolean;
  removeUIElements: boolean;
  truncateStackTraces: boolean;
}

interface FilterStats {
  removedByType: Record<string, number>;
  removedEntries: number;
  sizeAfter: number;
  sizeBefore: number;
  totalEntries: number;
}

interface TraceEntry {
  [key: string]: unknown;
  type: string;
}

export class PlaywrightTraceFilter {
  private stats: FilterStats = {
    removedByType: {},
    removedEntries: 0,
    sizeAfter: 0,
    sizeBefore: 0,
    totalEntries: 0,
  };

  /**
   * Filter a trace file and write the result
   */
  public async filterTraceFile(
    inputPath: string,
    outputPath: string,
    filterOptions: FilterOptions
  ): Promise<FilterStats> {
    // Reset stats
    this.stats = {
      removedByType: {},
      removedEntries: 0,
      sizeAfter: 0,
      sizeBefore: 0,
      totalEntries: 0,
    };

    console.log(`📁 Reading trace file: ${inputPath}`);
    this.stats.sizeBefore = fs.statSync(inputPath).size;

    const filteredEntries: TraceEntry[] = [];

    try {
      const content = fs.readFileSync(inputPath, "utf8");
      const lines = content.split("\n");

      for (const [lineNum, line] of lines.entries()) {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
          continue;
        }

        try {
          const entry: TraceEntry = JSON.parse(trimmedLine);
          this.stats.totalEntries += 1;

          if (!this.shouldRemoveEntry(entry, filterOptions)) {
            filteredEntries.push(entry);
          }
        } catch (error) {
          console.warn(
            `⚠️  JSON decode error on line ${lineNum + 1}: ${error}`
          );
          // Keep malformed entries to avoid data loss
          filteredEntries.push({
            error: String(error),
            line: trimmedLine,
            type: "malformed",
          });
        }
      }
    } catch (error) {
      throw new Error(`Error reading file: ${error}`);
    }

    // Write filtered trace
    console.log(`💾 Writing filtered trace: ${outputPath}`);
    try {
      const filteredContent = filteredEntries
        .map((entry) => JSON.stringify(entry, null, 0))
        .join("\n");

      fs.writeFileSync(outputPath, filteredContent + "\n", "utf8");
    } catch (error) {
      throw new Error(`Error writing file: ${error}`);
    }

    this.stats.sizeAfter = fs.statSync(outputPath).size;
    this.printSummary();

    return this.stats;
  }

  /**
   * Format file size in human readable format
   */
  private formatSize(sizeBytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = sizeBytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Check if a console log contains important information
   */
  private isImportantConsoleLog(entry: TraceEntry): boolean {
    const text = String(entry.text || "").toLowerCase();
    const importantKeywords = [
      "error",
      "warning",
      "failed",
      "exception",
      "uncaught",
      "test",
      "assertion",
      "timeout",
      "network",
      "xhr",
      "fetch",
    ];
    return importantKeywords.some((keyword) => text.includes(keyword));
  }

  /**
   * Print filtering summary
   */
  private printSummary(): void {
    const sizeReduction = this.stats.sizeBefore - this.stats.sizeAfter;
    const sizeReductionPct =
      this.stats.sizeBefore > 0
        ? (sizeReduction / this.stats.sizeBefore) * 100
        : 0;

    console.log("\n" + "=".repeat(60));
    console.log("📊 FILTERING SUMMARY");
    console.log("=".repeat(60));
    console.log(
      `📋 Total entries processed: ${this.stats.totalEntries.toLocaleString()}`
    );
    console.log(
      `🗑️  Entries removed: ${this.stats.removedEntries.toLocaleString()}`
    );
    console.log(
      `✅ Entries kept: ${(this.stats.totalEntries - this.stats.removedEntries).toLocaleString()}`
    );
    console.log(
      `📉 Removal rate: ${((this.stats.removedEntries / this.stats.totalEntries) * 100).toFixed(1)}%`
    );
    console.log();
    console.log(`📦 Original size: ${this.formatSize(this.stats.sizeBefore)}`);
    console.log(`📦 Filtered size: ${this.formatSize(this.stats.sizeAfter)}`);
    console.log(
      `💾 Size reduction: ${this.formatSize(sizeReduction)} (${sizeReductionPct.toFixed(1)}%)`
    );
    console.log();

    if (Object.keys(this.stats.removedByType).length > 0) {
      console.log("🏷️  Removed by type:");
      for (const [removalType, count] of Object.entries(
        this.stats.removedByType
      ).sort()) {
        console.log(`   • ${removalType}: ${count.toLocaleString()} entries`);
      }
    }
    console.log("=".repeat(60));
  }

  /**
   * Determine if an entry should be removed based on filter options
   */
  private shouldRemoveEntry(
    entry: TraceEntry,
    filterOptions: FilterOptions
  ): boolean {
    const entryType = entry.type || "";

    // Remove frame snapshots (huge HTML DOM trees)
    if (filterOptions.removeFrameSnapshots && entryType === "frame-snapshot") {
      this.updateRemovalStats("frame-snapshot");
      return true;
    }

    // Remove screencast frames (frequent video frame references)
    if (
      filterOptions.removeScreencastFrames &&
      entryType === "screencast-frame"
    ) {
      this.updateRemovalStats("screencast-frame");
      return true;
    }

    // Remove verbose console logs but keep errors
    if (filterOptions.filterConsoleLogs && entryType === "console") {
      const messageType = String(entry.messageType || "");
      if (
        ["info", "log"].includes(messageType) &&
        !this.isImportantConsoleLog(entry)
      ) {
        this.updateRemovalStats("console-verbose");
        return true;
      }
    }

    // Remove repetitive UI element snapshots
    if (
      filterOptions.removeUIElements &&
      ["button", "checkbox", "input", "text"].includes(entryType)
    ) {
      this.updateRemovalStats("ui-elements");
      return true;
    }

    // Truncate extremely long stack traces
    if (filterOptions.truncateStackTraces && entryType === "console") {
      if (
        entry.text &&
        typeof entry.text === "string" &&
        entry.text.length > 5000
      ) {
        // Keep first and last parts of very long traces
        const text = entry.text;
        if (text.includes("\n    at ")) {
          // React stack trace pattern
          const lines = text.split("\n");
          if (lines.length > 20) {
            entry.text = [
              ...lines.slice(0, 10),
              "    ... [truncated stack trace] ...",
              ...lines.slice(-5),
            ].join("\n");
          }
        }
      }
    }

    return false;
  }

  /**
   * Update statistics for removed entries
   */
  private updateRemovalStats(removalType: string): void {
    this.stats.removedEntries += 1;
    if (!this.stats.removedByType[removalType]) {
      this.stats.removedByType[removalType] = 0;
    }
    this.stats.removedByType[removalType] += 1;
  }
}

/**
 * Define filtering presets for different use cases
 */
export function createFilterPresets(): Record<string, FilterOptions> {
  return {
    conservative: {
      filterConsoleLogs: false,
      removeFrameSnapshots: true,
      removeScreencastFrames: false,
      removeUIElements: false,
      truncateStackTraces: true,
    },
    minimal: {
      filterConsoleLogs: true,
      removeFrameSnapshots: true,
      removeScreencastFrames: true,
      removeUIElements: true,
      truncateStackTraces: true,
    },
    moderate: {
      filterConsoleLogs: false,
      removeFrameSnapshots: true,
      removeScreencastFrames: true,
      removeUIElements: true,
      truncateStackTraces: true,
    },
  };
}

/**
 * Convenience function to filter a trace file with a preset
 */
export async function filterTraceWithPreset(
  inputPath: string,
  outputPath: string,
  preset: "conservative" | "minimal" | "moderate" = "minimal"
): Promise<FilterStats> {
  const presets = createFilterPresets();
  const filterOptions = presets[preset];

  if (!filterOptions) {
    throw new Error(`Unknown preset: ${preset}`);
  }

  const filter = new PlaywrightTraceFilter();
  return filter.filterTraceFile(inputPath, outputPath, filterOptions);
}
