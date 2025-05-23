#!/usr/bin/env python3
"""
Playwright Trace Filter

Filters large Playwright trace files to remove bloated data while preserving
essential debugging information for LLM-based trace analysis.

Usage:
    python filter_trace.py <input_trace> [output_trace] [--options]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict


class PlaywrightTraceFilter:
    def __init__(self):
        self.stats = {
            "total_entries": 0,
            "removed_entries": 0,
            "size_before": 0,
            "size_after": 0,
            "removed_by_type": {},
        }

    def should_remove_entry(
        self, entry: Dict[str, Any], filter_options: Dict[str, bool]
    ) -> bool:
        """Determine if an entry should be removed based on filter options"""
        entry_type = entry.get("type", "")

        # Remove frame snapshots (huge HTML DOM trees)
        if filter_options["remove_frame_snapshots"] and entry_type == "frame-snapshot":
            self._update_removal_stats("frame-snapshot")
            return True

        # Remove screencast frames (frequent video frame references)
        if (
            filter_options["remove_screencast_frames"]
            and entry_type == "screencast-frame"
        ):
            self._update_removal_stats("screencast-frame")
            return True

        # Remove verbose console logs but keep errors
        if filter_options["filter_console_logs"] and entry_type == "console":
            message_type = entry.get("messageType", "")
            if message_type in ["log", "info"] and not self._is_important_console_log(
                entry
            ):
                self._update_removal_stats("console-verbose")
                return True

        # Remove repetitive UI element snapshots
        if filter_options["remove_ui_elements"] and entry_type in [
            "button",
            "input",
            "text",
            "checkbox",
        ]:
            self._update_removal_stats("ui-elements")
            return True

        # Truncate extremely long stack traces
        if filter_options["truncate_stack_traces"] and entry_type == "console":
            if "text" in entry and len(entry["text"]) > 5000:
                # Keep first and last parts of very long traces
                text = entry["text"]
                if "\n    at " in text:  # React stack trace pattern
                    lines = text.split("\n")
                    if len(lines) > 20:
                        entry["text"] = "\n".join(
                            lines[:10]
                            + ["    ... [truncated stack trace] ..."]
                            + lines[-5:]
                        )

        return False

    def _is_important_console_log(self, entry: Dict[str, Any]) -> bool:
        """Check if a console log contains important information"""
        text = entry.get("text", "").lower()
        important_keywords = [
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
        ]
        return any(keyword in text for keyword in important_keywords)

    def _update_removal_stats(self, removal_type: str):
        """Update statistics for removed entries"""
        self.stats["removed_entries"] += 1
        if removal_type not in self.stats["removed_by_type"]:
            self.stats["removed_by_type"][removal_type] = 0
        self.stats["removed_by_type"][removal_type] += 1

    def filter_trace_file(
        self, input_path: Path, output_path: Path, filter_options: Dict[str, bool]
    ):
        """Filter a trace file and write the result"""

        print(f"📁 Reading trace file: {input_path}")
        self.stats["size_before"] = input_path.stat().st_size

        filtered_entries = []

        try:
            with open(input_path, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        entry = json.loads(line)
                        self.stats["total_entries"] += 1

                        if not self.should_remove_entry(entry, filter_options):
                            filtered_entries.append(entry)

                    except json.JSONDecodeError as e:
                        print(f"⚠️  JSON decode error on line {line_num}: {e}")
                        # Keep malformed entries to avoid data loss
                        filtered_entries.append(
                            {"type": "malformed", "line": line, "error": str(e)}
                        )

        except Exception as e:
            print(f"❌ Error reading file: {e}")
            sys.exit(1)

        # Write filtered trace
        print(f"💾 Writing filtered trace: {output_path}")
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                for entry in filtered_entries:
                    f.write(json.dumps(entry, separators=(",", ":")) + "\n")

        except Exception as e:
            print(f"❌ Error writing file: {e}")
            sys.exit(1)

        self.stats["size_after"] = output_path.stat().st_size
        self._print_summary()

    def _print_summary(self):
        """Print filtering summary"""
        size_reduction = self.stats["size_before"] - self.stats["size_after"]
        size_reduction_pct = (
            (size_reduction / self.stats["size_before"]) * 100
            if self.stats["size_before"] > 0
            else 0
        )

        print("\n" + "=" * 60)
        print("📊 FILTERING SUMMARY")
        print("=" * 60)
        print(f"📋 Total entries processed: {self.stats['total_entries']:,}")
        print(f"🗑️  Entries removed: {self.stats['removed_entries']:,}")
        print(
            f"✅ Entries kept: {self.stats['total_entries'] - self.stats['removed_entries']:,}"
        )
        print(
            f"📉 Removal rate: {(self.stats['removed_entries'] / self.stats['total_entries'] * 100):.1f}%"
        )
        print()
        print(f"📦 Original size: {self._format_size(self.stats['size_before'])}")
        print(f"📦 Filtered size: {self._format_size(self.stats['size_after'])}")
        print(
            f"💾 Size reduction: {self._format_size(size_reduction)} ({size_reduction_pct:.1f}%)"
        )
        print()

        if self.stats["removed_by_type"]:
            print("🏷️  Removed by type:")
            for removal_type, count in sorted(self.stats["removed_by_type"].items()):
                print(f"   • {removal_type}: {count:,} entries")
        print("=" * 60)

    def _format_size(self, size_bytes: int) -> str:
        """Format file size in human readable format"""
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} TB"


def create_filter_presets() -> Dict[str, Dict[str, bool]]:
    """Define filtering presets for different use cases"""
    return {
        "minimal": {
            "remove_frame_snapshots": True,
            "remove_screencast_frames": True,
            "filter_console_logs": True,
            "remove_ui_elements": True,
            "truncate_stack_traces": True,
        },
        "moderate": {
            "remove_frame_snapshots": True,
            "remove_screencast_frames": True,
            "filter_console_logs": False,
            "remove_ui_elements": True,
            "truncate_stack_traces": True,
        },
        "conservative": {
            "remove_frame_snapshots": True,
            "remove_screencast_frames": False,
            "filter_console_logs": False,
            "remove_ui_elements": False,
            "truncate_stack_traces": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Filter Playwright trace files to remove bloated data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Filter Presets:
  minimal     - Remove all bloat, keep only essential debugging data (recommended for LLMs)
  moderate    - Remove DOM snapshots and screencast frames, keep console logs  
  conservative- Remove only DOM snapshots, keep most data

Examples:
  python filter_trace.py trace.trace                    # Use minimal preset
  python filter_trace.py trace.trace --preset moderate
  python filter_trace.py trace.trace filtered.trace --custom
        """,
    )

    parser.add_argument("input", type=Path, help="Input trace file")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Output trace file (default: input_filtered.trace)",
    )
    parser.add_argument(
        "--preset",
        choices=["minimal", "moderate", "conservative"],
        default="minimal",
        help="Filtering preset (default: minimal)",
    )
    parser.add_argument(
        "--custom", action="store_true", help="Use custom filtering options"
    )
    parser.add_argument(
        "--no-frame-snapshots",
        action="store_true",
        help="Remove frame snapshots (DOM trees)",
    )
    parser.add_argument(
        "--no-screencast-frames", action="store_true", help="Remove screencast frames"
    )
    parser.add_argument(
        "--filter-console", action="store_true", help="Filter verbose console logs"
    )
    parser.add_argument(
        "--no-ui-elements", action="store_true", help="Remove UI element snapshots"
    )
    parser.add_argument(
        "--truncate-stacks", action="store_true", help="Truncate long stack traces"
    )

    args = parser.parse_args()

    # Validate input file
    if not args.input.exists():
        print(f"❌ Input file not found: {args.input}")
        sys.exit(1)

    # Determine output file
    if args.output is None:
        output_path = (
            args.input.parent / f"{args.input.stem}_filtered{args.input.suffix}"
        )
    else:
        output_path = args.output

    # Determine filter options
    if args.custom:
        filter_options = {
            "remove_frame_snapshots": args.no_frame_snapshots,
            "remove_screencast_frames": args.no_screencast_frames,
            "filter_console_logs": args.filter_console,
            "remove_ui_elements": args.no_ui_elements,
            "truncate_stack_traces": args.truncate_stacks,
        }
    else:
        presets = create_filter_presets()
        filter_options = presets[args.preset]

    # Show configuration
    print("🎯 FILTER CONFIGURATION")
    print("-" * 30)
    if not args.custom:
        print(f"Preset: {args.preset}")
    for option, enabled in filter_options.items():
        status = "✅" if enabled else "❌"
        print(f"{status} {option.replace('_', ' ').title()}")
    print("-" * 30)
    print()

    # Apply filtering
    filter_tool = PlaywrightTraceFilter()
    filter_tool.filter_trace_file(args.input, output_path, filter_options)

    print(f"\n🎉 Filtering complete! Filtered trace saved to: {output_path}")


if __name__ == "__main__":
    main()
