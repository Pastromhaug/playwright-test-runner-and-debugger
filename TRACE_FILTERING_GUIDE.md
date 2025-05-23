# Playwright Trace Filtering Guide

## 🎯 Problem Statement

Playwright trace files can become extremely large (1-2MB+) due to bloated data that's not useful for debugging, making them difficult to process for LLM-based trace analysis. This guide explains what causes the bloat and how to filter it effectively.

## 📊 Analysis Results

**Example trace file analysis:** `0-trace.trace` (1.9MB, 863 entries)

### Data Distribution by Type:
| Type | Count | Description | Debugging Value | Size Impact |
|------|-------|-------------|-----------------|-------------|
| **frame-snapshot** | 320 | Complete HTML DOM trees | ❌ Low | 🔥 **HUGE** |
| **log** | 296 | Playwright operation logs | ✅ High | 🟢 Small |
| **screencast-frame** | 139 | Video frame references | ❌ Low | 🟡 Medium |
| **console** | 30 | Application console output | ✅ High | 🟡 Medium |
| **before/after** | 52 | API call boundaries | ✅ **Critical** | 🟢 Small |
| **UI elements** | 138 | Button/input snapshots | ❌ Low | 🟡 Medium |

### 🔥 Major Bloat Sources:

1. **Frame Snapshots (320 entries)** - The biggest problem
   - Contains complete HTML DOM trees with all styling, attributes, and nested elements
   - Each snapshot can be 50K-100K+ characters
   - Example: `⟪ 85,974 characters skipped ⟫` in a single snapshot
   - **Removes ~80-90% of file size**

2. **Screencast Frames (139 entries)** - Frequent but smaller
   - References to video frame images (SHA1 hashes)
   - Captured every few milliseconds during test execution
   - Not useful for debugging logic issues
   - **Each entry ~200 characters**

3. **Verbose Console Logs** - Variable impact
   - React stack traces can be extremely long (5000+ characters)
   - Development logs like "[HMR] connected" add noise
   - Error logs are valuable, info logs often aren't

## ✅ Essential Data for Debugging:

- **API calls** (`before`/`after` entries) - Test step execution flow
- **Error console logs** - Application errors and warnings  
- **Playwright logs** - Navigation, element finding, click actions
- **Context options** - Browser/test configuration
- **Events** - Page navigation, timeouts, etc.

## 🛠️ Filtering Tool Usage

### Quick Start:
```bash
# Use minimal preset (recommended for LLMs)
python filter_trace.py your_trace.trace

# Use different presets
python filter_trace.py trace.trace --preset moderate
python filter_trace.py trace.trace --preset conservative
```

### Presets:

#### 🎯 **Minimal** (Recommended for LLMs)
- ✅ Remove frame snapshots (DOM trees)
- ✅ Remove screencast frames  
- ✅ Filter verbose console logs
- ✅ Remove UI element snapshots
- ✅ Truncate long stack traces
- **Result: ~95% size reduction**

#### 🎛️ **Moderate** (Balanced)
- ✅ Remove frame snapshots
- ✅ Remove screencast frames
- ❌ Keep all console logs
- ✅ Remove UI elements
- ✅ Truncate stack traces
- **Result: ~85% size reduction**

#### 🛡️ **Conservative** (Minimal removal)
- ✅ Remove frame snapshots only
- ❌ Keep screencast frames
- ❌ Keep all console logs
- ❌ Keep UI elements
- ✅ Truncate stack traces
- **Result: ~70% size reduction**

### Custom Filtering:
```bash
python filter_trace.py trace.trace --custom \
  --no-frame-snapshots \
  --no-screencast-frames \
  --filter-console \
  --truncate-stacks
```

## 📈 Expected Results

**Before filtering:**
- File size: 1.9MB
- Entries: 863
- Mostly unusable for LLM analysis due to size

**After filtering (minimal preset):**
- File size: 84KB (95.7% reduction)
- Entries: 371 (57% removal rate)
- Clean, focused debugging data

### Removed Content:
- 320 frame snapshots (complete DOM trees)
- 139 screencast frames (video references)
- 24 UI element snapshots
- 9 verbose console logs

### Preserved Content:
- All API calls and test steps
- Error and warning console messages
- Playwright operation logs
- Browser context and configuration
- Event notifications

## 🎯 Integration with MCP Server

For MCP servers that process trace files:

1. **Pre-filter traces** before LLM analysis using minimal preset
2. **Keep original files** for edge cases requiring full data
3. **Use filtered traces** for primary debugging workflows
4. **Mention filtering** in trace analysis responses

### Example Integration:
```python
# In your MCP server
def get_trace(trace_directory):
    original_trace = f"{trace_directory}/trace.trace"
    filtered_trace = f"{trace_directory}/trace_filtered.trace"
    
    # Generate filtered version if not exists
    if not os.path.exists(filtered_trace):
        filter_trace_file(original_trace, filtered_trace, minimal_preset)
    
    # Use filtered version for analysis
    return load_trace(filtered_trace)
```

## 🔍 What Each Data Type Contains

### ✅ Keep These (Essential for debugging):

**API Calls (`before`/`after`)**:
```json
{"type":"before","callId":"pw:api@8","apiName":"page.goto","params":{"url":"http://localhost:8000/login"}}
{"type":"after","callId":"pw:api@8","endTime":1252.477,"result":{"response":"<Response>"}}
```

**Important Console Logs**:
```json
{"type":"console","messageType":"error","text":"Failed to load resource: the server responded with a status of 403"}
```

**Playwright Operation Logs**:
```json
{"type":"log","message":"navigating to \"http://localhost:8000/login\", waiting until \"load\""}
```

### ❌ Remove These (Bloated, low debugging value):

**Frame Snapshots**:
```json
{"type":"frame-snapshot","snapshot":{"frameUrl":"http://localhost:8000/login","html":"<!DOCTYPE html><html>... [85,000+ characters] ..."}}
```

**Screencast Frames**:
```json
{"type":"screencast-frame","sha1":"page@abc-1748015854292.jpeg","timestamp":937.298}
```

**Verbose Console Logs**:
```json
{"type":"console","messageType":"info","text":"[HMR] connected"}
```

## 💡 Tips for LLM Analysis

After filtering, the trace will contain:
- **Test execution flow** - Easy to follow step-by-step
- **Error details** - Console errors and warnings preserved
- **Timing information** - When each action occurred
- **Network activity** - Failed requests and responses
- **Element interactions** - What was clicked/filled

The filtered trace provides all information needed for:
- ✅ Understanding test failure causes
- ✅ Identifying timing issues
- ✅ Debugging element selection problems
- ✅ Analyzing application errors
- ✅ Following user interaction flows

Without overwhelming LLMs with:
- ❌ Massive HTML DOM trees
- ❌ Redundant visual snapshots  
- ❌ Frequent video frames
- ❌ Development noise logs

## 🚀 Next Steps

1. **Test the filtering tool** on your trace files
2. **Integrate filtering** into your MCP server workflow
3. **Adjust presets** based on your specific debugging needs
4. **Monitor results** to ensure essential data isn't lost

The goal is making trace files **LLM-friendly** while preserving all **debugging-critical** information. 