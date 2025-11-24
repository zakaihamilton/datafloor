"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Download, 
  FileType, 
  AlertCircle,
  Database,
  ArrowRightLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Info,
  FileText,
  ArrowUp,
  ArrowDown,
  ToggleLeft,
  ToggleRight,
  Settings,
  FileCog,
  Calculator,
  Copy,
  Check
} from 'lucide-react';

// -- EXTERNAL LIBRARIES VIA CDN INJECTION --

const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const loadModule = async (url) => {
  try {
    // eslint-disable-next-line no-new-func
    const importFn = new Function('url', 'return import(url)');
    const module = await importFn(url);
    return module;
  } catch (e) {
    console.error("Failed to load module:", url, e);
    throw e;
  }
};

// -- APP COMPONENT --

export default function DataFloor() {
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [fileName, setFileName] = useState("Untitled");
  const [fileType, setFileType] = useState(null); // 'csv', 'parquet', 'json', 'custom'
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  // Import Configuration State
  const [pendingFile, setPendingFile] = useState(null); // File waiting for config
  const [importDelimiter, setImportDelimiter] = useState(""); // Default delimiter: "" (Auto)
  const [customExtension, setCustomExtension] = useState(null); // Store original ext for export
  const [forceCustomConfig, setForceCustomConfig] = useState(false); // Flag to bypass auto-detection
  
  // Feature Flags
  const [showEmptyStats, setShowEmptyStats] = useState(true);
  
  // Pagination & Sort State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  
  // Hover State for Stats
  const [hoveredColumn, setHoveredColumn] = useState(null);
  const [copiedColumn, setCopiedColumn] = useState(null); // To show "Check" icon
  const hoverTimeoutRef = useRef(null);
  const leaveTimeoutRef = useRef(null); // Grace period for moving to tooltip

  // Libraries refs
  const papaRef = useRef(null);
  const hyparquetRef = useRef(null);
  const arrowRef = useRef(null);
  const parquetWasmRef = useRef(null);

  useEffect(() => {
    // Initialize Reader Libraries (Lightweight)
    const init = async () => {
      try {
        // Load PapaParse for CSV
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js');
        papaRef.current = window.Papa;

        // Load HyParquet for Parquet Reading
        const hyparquet = await loadModule('https://cdn.jsdelivr.net/npm/hyparquet/+esm');
        hyparquetRef.current = hyparquet;
        
      } catch (err) {
        console.error(err);
        setError("Failed to initialize data libraries. Please refresh.");
      }
    };
    init();
  }, []);

  // -- STATISTICS --
  const emptyCellCounts = useMemo(() => {
    if (!showEmptyStats) return {};

    const counts = {};
    columns.forEach(col => counts[col] = 0);
    
    data.forEach(row => {
      columns.forEach(col => {
        const val = row[col];
        if (val === null || val === undefined || val === '') {
          counts[col] = (counts[col] || 0) + 1;
        }
      });
    });
    return counts;
  }, [data, columns, showEmptyStats]);

  // Dynamic Stats for Hovered Column (Mean, Median, Mode/Range)
  const activeColumnStats = useMemo(() => {
    if (!hoveredColumn || data.length === 0) return null;

    const numericValues = [];
    const dateValues = [];
    
    // Single pass extraction with type detection
    for (const row of data) {
      const val = row[hoveredColumn];
      // Check if value exists
      if (val !== null && val !== undefined && val !== '') {
        // Try Numeric first
        const num = Number(val);
        if (!isNaN(num)) {
          numericValues.push(num);
        } else {
            // If not a number, try Date
            const dateTimestamp = Date.parse(val);
            if (!isNaN(dateTimestamp)) {
                dateValues.push(dateTimestamp);
            }
        }
      }
    }

    // Determine column type based on majority
    const isDateColumn = dateValues.length > numericValues.length;
    const values = isDateColumn ? dateValues : numericValues;

    if (values.length === 0) return null; // No analyzable data

    // Mean Calculation
    const sum = values.reduce((a, b) => a + b, 0);
    const meanVal = sum / values.length;

    // Median Calculation (Sort is required for Median and Min/Max)
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const medianVal = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

    // -- Type Specific Stats --
    let modeLabel = null;
    let minStr = null;
    let maxStr = null;

    if (isDateColumn) {
        // Date: Calculate Oldest (Min) and Newest (Max)
        const minVal = values[0];
        const maxVal = values[values.length - 1];
        minStr = new Date(minVal).toLocaleDateString();
        maxStr = new Date(maxVal).toLocaleDateString();
    } else {
        // Numeric: Calculate Mode
        const freq = {};
        let maxFreq = 0;
        for (const n of values) {
            freq[n] = (freq[n] || 0) + 1;
            if (freq[n] > maxFreq) maxFreq = freq[n];
        }
        
        modeLabel = "None";
        if (maxFreq > 1) {
             const modes = Object.keys(freq).filter(k => freq[k] === maxFreq).map(Number);
             // Limit display to 3 modes
             if (modes.length > 3) {
                 modeLabel = `${modes.slice(0, 3).map(v => v.toLocaleString(undefined, { maximumFractionDigits: 2 })).join(', ')}...`;
             } else {
                 modeLabel = modes.map(v => v.toLocaleString(undefined, { maximumFractionDigits: 2 })).join(', ');
             }
        }
    }

    // Format Mean/Median for display
    let meanStr, medianStr;
    if (isDateColumn) {
        meanStr = new Date(meanVal).toLocaleDateString();
        medianStr = new Date(medianVal).toLocaleDateString();
    } else {
        meanStr = meanVal.toLocaleString(undefined, { maximumFractionDigits: 2 });
        medianStr = medianVal.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    return {
      columnName: hoveredColumn,
      type: isDateColumn ? 'Date' : 'Numeric',
      mean: meanStr,
      median: medianStr,
      mode: modeLabel,
      min: minStr,
      max: maxStr,
      count: values.length
    };

  }, [data, hoveredColumn]);

  // -- APP ACTIONS --

  const resetApp = () => {
    setData([]);
    setColumns([]);
    setFileName("Untitled");
    setFileType(null);
    setSearchTerm("");
    setCurrentPage(1);
    setSortConfig({ key: null, direction: 'asc' });
    setError(null);
    setPendingFile(null);
    setImportDelimiter(""); // Reset to Auto
    setCustomExtension(null);
    setForceCustomConfig(false);
    setHoveredColumn(null);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
  };

  const handleSort = (key) => {
    let direction = 'asc';
    let newKey = key;

    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        direction = 'desc';
      } else if (sortConfig.direction === 'desc') {
        newKey = null;
        direction = 'asc'; 
      }
    }
    
    setSortConfig({ key: newKey, direction });
  };

  const handleMouseEnterColumn = (col) => {
    // Clear any pending leave action (grace period)
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    
    // Clear pending enter action if switching columns quickly
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    // If already hovering this column, do nothing (stays open)
    if (hoveredColumn === col) return;

    // Set a delay before triggering the heavy calc / tooltip
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredColumn(col);
    }, 1000);
  };

  const handleMouseLeaveColumn = () => {
    // Clear the enter timer so we don't open if we just left quickly
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

    // Set a grace period before closing.
    // This allows the user to move their mouse from the header text TO the tooltip
    // without the tooltip disappearing instantly due to the gap.
    leaveTimeoutRef.current = setTimeout(() => {
        setHoveredColumn(null);
        setCopiedColumn(null); // Reset copy feedback when tooltip closes
    }, 300);
  };

  const handleCopyStats = (e) => {
    e.stopPropagation(); // Prevent sort trigger
    if (!activeColumnStats) return;

    const { columnName, type, count, mean, median, mode, min, max } = activeColumnStats;
    
    let text = `Column: ${columnName}\nType: ${type}\nCount (Valid): ${count}\nMean: ${mean}\nMedian: ${median}`;
    
    if (type === 'Date') {
        text += `\nOldest: ${min}\nNewest: ${max}`;
    } else {
        text += `\nMode: ${mode}`;
    }

    // Fallback copy method for iframes/older browsers
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedColumn(columnName);
            setTimeout(() => setCopiedColumn(null), 2000);
        });
    } else {
        // Create hidden textarea fallback
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopiedColumn(columnName);
        setTimeout(() => setCopiedColumn(null), 2000);
    }
  };

  // -- FILE HANDLING --

  const handleFileUpload = async (file) => {
    setLoading(true);
    setError(null);
    setFileName(file.name);
    
    const lowerName = file.name.toLowerCase();

    // If forced custom config OR unknown extension, open modal
    if (forceCustomConfig || (!lowerName.endsWith('.csv') && !lowerName.endsWith('.parquet') && !lowerName.endsWith('.json'))) {
       setLoading(false);
       setPendingFile(file);
       setForceCustomConfig(false); // Reset flag
       return;
    }

    // Standard Auto-Load Logic
    if (lowerName.endsWith('.csv')) {
      setLoadingMsg("Parsing CSV...");
      setFileType('csv');
      parseCSV(file);
    } else if (lowerName.endsWith('.parquet')) {
      setLoadingMsg("Parsing Parquet...");
      setFileType('parquet');
      await parseParquet(file);
    } else if (lowerName.endsWith('.json')) {
      setLoadingMsg("Parsing JSON...");
      setFileType('json');
      await parseJSON(file);
    }
  };

  // Triggered from the Import Config Modal
  const processPendingFile = () => {
    if (!pendingFile) return;
    
    setLoading(true);
    setLoadingMsg("Parsing custom file...");
    setPendingFile(null); // Close modal
    
    // Capture original extension for export
    const match = pendingFile.name.match(/\.[^/.]+$/);
    setCustomExtension(match ? match[0] : ".txt");
    
    setFileType('custom'); 
    parseCSV(pendingFile, importDelimiter);
  };

  const parseCSV = (file, delimiter = "") => {
    if (!papaRef.current) return;
    
    // Handle escaped tab characters if user typed "\t"
    const actualDelimiter = delimiter === "\\t" ? "\t" : delimiter;

    papaRef.current.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: actualDelimiter, // Empty string = auto-detect
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          setColumns(Object.keys(results.data[0]));
          setData(results.data);
        }
        setLoading(false);
      },
      error: (err) => {
        setError("Error parsing file: " + err.message);
        setLoading(false);
      }
    });
  };

  const parseJSON = async (file) => {
    try {
      const text = await file.text();
      let jsonData;
      try {
        jsonData = JSON.parse(text);
      } catch (e) {
        throw new Error("Invalid JSON format. Please ensure file contains valid JSON.");
      }

      if (!Array.isArray(jsonData)) {
        throw new Error("JSON file must contain an array of objects (e.g. [{}, {}]).");
      }

      if (jsonData.length > 0) {
        const allKeys = new Set();
        const sampleSize = Math.min(jsonData.length, 100);
        
        for (let i = 0; i < sampleSize; i++) {
          const row = jsonData[i];
          if (row && typeof row === 'object') {
            Object.keys(row).forEach(k => allKeys.add(k));
          }
        }
        
        const cols = Array.from(allKeys);
        setColumns(cols);

        const sanitizedRows = jsonData.map(row => {
           const newRow = {};
           cols.forEach(col => {
             let val = row[col];
             if (typeof val === 'object' && val !== null) {
               val = JSON.stringify(val);
             }
             newRow[col] = (val === undefined || val === null) ? '' : val;
           });
           return newRow;
        });

        setData(sanitizedRows);
      }
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const parseParquet = async (file) => {
    if (!hyparquetRef.current) {
      setError("Parquet library not loaded. Please refresh.");
      setLoading(false);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      
      await hyparquetRef.current.parquetRead({
        file: arrayBuffer,
        rowFormat: 'object',
        onComplete: (rows) => {
          if (rows.length > 0) {
            const firstRow = rows[0];
            const cols = Object.keys(firstRow);
            setColumns(cols);
            
            const sanitizedRows = rows.map(row => {
               const newRow = {};
               cols.forEach(col => {
                 let val = row[col];
                 if (typeof val === 'object' && val !== null) {
                   val = JSON.stringify(val);
                 }
                 newRow[col] = val;
               });
               return newRow;
            });

            setData(sanitizedRows);
          }
          setLoading(false);
        }
      });
    } catch (err) {
      console.error(err);
      setError("Failed to parse Parquet file. It might use an unsupported compression codec (e.g. LZO).");
      setLoading(false);
    }
  };

  // -- EXPORTING --

  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const jsonStr = JSON.stringify(data, null, 2);
    downloadFile(jsonStr, fileName.replace(/\.[^/.]+$/, "") + "_exported.json", 'application/json');
    setShowExportMenu(false);
  };

  const exportCSV = () => {
    if (!papaRef.current) return;
    const csv = papaRef.current.unparse(data);
    downloadFile(csv, fileName.replace(/\.[^/.]+$/, "") + "_exported.csv", 'text/csv');
    setShowExportMenu(false);
  };

  const exportCustom = () => {
    if (!papaRef.current) return;
    const actualDelimiter = importDelimiter === "\\t" ? "\t" : importDelimiter;
    // Use the imported delimiter, fallback to comma if auto/empty
    const finalDelimiter = actualDelimiter || ",";
    
    const csv = papaRef.current.unparse(data, { delimiter: finalDelimiter });
    const exportName = fileName.replace(/\.[^/.]+$/, "") + "_exported" + (customExtension || ".txt");
    downloadFile(csv, exportName, 'text/plain');
    setShowExportMenu(false);
  };

  const exportParquet = async () => {
    setShowExportMenu(false);
    setLoading(true);
    setLoadingMsg("Loading Parquet Writer (WASM)...");

    try {
      if (!arrowRef.current) {
         arrowRef.current = await loadModule('https://cdn.jsdelivr.net/npm/apache-arrow@13.0.0/+esm');
      }
      
      if (!parquetWasmRef.current) {
        const wasmModule = await loadModule('https://cdn.jsdelivr.net/npm/parquet-wasm@0.6.1/esm/parquet_wasm.js');
        await wasmModule.default('https://cdn.jsdelivr.net/npm/parquet-wasm@0.6.1/esm/parquet_wasm_bg.wasm');
        parquetWasmRef.current = wasmModule;
      }

      setLoadingMsg("Converting Data...");
      const Arrow = arrowRef.current;
      const Parquet = parquetWasmRef.current;
      
      const arrowColumns = {};
      columns.forEach(colName => {
        const colValues = data.map(row => {
          const val = row[colName];
          return val === undefined || val === null ? null : String(val);
        });
        arrowColumns[colName] = Arrow.vectorFromArray(colValues, new Arrow.Utf8);
      });

      const jsTable = new Arrow.Table(arrowColumns);
      const ipcStream = Arrow.tableToIPC(jsTable, 'stream');

      setLoadingMsg("Compressing...");
      let wasmTable;
      try {
        wasmTable = Parquet.Table.fromIPCStream(ipcStream);
      } catch (e) {
        throw new Error("Failed to create WASM Table from data: " + e.message);
      }

      const parquetUint8Array = Parquet.writeParquet(wasmTable);
      downloadFile(parquetUint8Array, fileName.replace(/\.[^/.]+$/, "") + "_exported.parquet", 'application/vnd.apache.parquet');
      
      setLoading(false);

    } catch (err) {
      console.error("Parquet Export Failed:", err);
      const useJson = window.confirm(
        "Parquet export failed.\n\n" + 
        "Error: " + err.message + "\n\n" +
        "Download as JSON instead?"
      );
      if (useJson) {
        const jsonStr = JSON.stringify(data, null, 2);
        downloadFile(jsonStr, fileName.replace(/\.[^/.]+$/, "") + "_exported.json", 'application/json');
      }
      setLoading(false);
    }
  };

  // -- EDITING --

  const updateCell = (rowIndex, col, value) => {
    const realIndex = (currentPage - 1) * rowsPerPage + rowIndex;
    const newData = [...data];
    newData[realIndex] = { ...newData[realIndex], [col]: value };
    setData(newData);
  };

  // -- UI HELPERS --

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // -- RENDER LOGIC --

  const filteredData = useMemo(() => {
    return data.filter(row => 
      Object.values(row).some(val => 
        String(val).toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [data, searchTerm]);

  const sortedData = useMemo(() => {
    let sortableItems = [...filteredData];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        const aNum = Number(aValue);
        const bNum = Number(bValue);

        if (!isNaN(aNum) && !isNaN(bNum) && aValue !== '' && bValue !== '') {
            aValue = aNum;
            bValue = bNum;
        } else {
            aValue = String(aValue).toLowerCase();
            bValue = String(bValue).toLowerCase();
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / rowsPerPage);
  const currentRows = sortedData.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const isHome = data.length === 0;

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans">
      
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-20 relative">
        <div 
          className={`flex items-center gap-3 ${!isHome ? "cursor-pointer group transition-transform active:scale-95" : ""}`}
          onClick={!isHome ? resetApp : undefined}
          title={!isHome ? "Return to Home" : ""}
        >
          <div className={`bg-indigo-600 p-2 rounded-lg text-white ${!isHome ? "group-hover:bg-indigo-700" : ""} transition-colors`}>
            <Database size={24} />
          </div>
          <div>
            <h1 className={`text-xl font-bold text-slate-900 tracking-tight ${!isHome ? "group-hover:text-indigo-600" : ""} transition-colors`}>DataFloor</h1>
            <p className="text-xs text-slate-500 font-medium">Parquet, JSON and CSV Converter & Editor</p>
          </div>
        </div>

        {data.length > 0 && (
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                <FileText size={14} className="text-slate-500"/>
                <span className="text-sm font-semibold text-slate-900 max-w-[200px] truncate" title={fileName}>{fileName}</span>
                <span className="text-slate-300">|</span>
                <span className="text-sm font-semibold text-slate-700">{fileType ? fileType.toUpperCase() : 'UNKNOWN'}</span>
                <span className="text-slate-300">|</span>
                <span className="text-sm text-slate-500">{data.length.toLocaleString()} rows</span>
             </div>
             
             <div className="h-6 w-px bg-slate-200 mx-2"></div>

             {/* Export Dropdown */}
             <div className="relative">
               <button 
                 type="button"
                 onClick={() => setShowExportMenu(!showExportMenu)}
                 disabled={loading}
                 className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
               >
                 <Download size={16} />
                 Export
                 <ChevronDown size={16} />
               </button>

               {showExportMenu && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)}></div>
                   <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-100">
                     <button
                       type="button"
                       onClick={exportCSV}
                       className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                     >
                       <FileSpreadsheet size={16} />
                       CSV (.csv)
                     </button>
                     <button
                       type="button"
                       onClick={exportParquet}
                       className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                     >
                       <ArrowRightLeft size={16} />
                       Parquet (.parquet)
                     </button>
                     <button
                       type="button"
                       onClick={exportJSON}
                       className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                     >
                       <div className="w-4 h-4 flex items-center justify-center font-mono text-[10px] border border-current rounded">{'{}'}</div>
                       JSON (.json)
                     </button>
                     {/* CUSTOM EXPORT OPTION */}
                     {fileType === 'custom' && (
                       <button
                         type="button"
                         onClick={exportCustom}
                         className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2 border-t border-slate-100"
                       >
                         <FileCog size={16} />
                         Original ({customExtension})
                       </button>
                     )}
                   </div>
                 </>
               )}
             </div>
          </div>
        )}
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-hidden relative">
        
        {/* MODAL: Custom Import Config */}
        {pendingFile && (
          <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 mb-4 text-indigo-600">
                <FileCog size={28} />
                <h3 className="text-xl font-bold text-slate-900">Import Settings</h3>
              </div>
              
              <div className="space-y-4">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium uppercase mb-1">Selected File</p>
                  <p className="text-sm text-slate-800 font-semibold truncate">{pendingFile.name}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Data Separator (Delimiter)
                  </label>
                  <p className="text-xs text-slate-500 mb-2">
                    Specify how columns are separated in this file.
                  </p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={importDelimiter}
                      onChange={(e) => setImportDelimiter(e.target.value)}
                      placeholder="e.g. , or ; or \t"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                    <select 
                      onChange={(e) => setImportDelimiter(e.target.value)}
                      value={importDelimiter}
                      className="px-3 py-2 border border-slate-300 rounded-md bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                    >
                      <option value="">Auto</option>
                      <option value=",">Comma (,)</option>
                      <option value=";">Semicolon (;)</option>
                      <option value="|">Pipe (|)</option>
                      <option value="\t">Tab (\t)</option>
                      <option value=" ">Space ( )</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button 
                    type="button"
                    onClick={() => { setPendingFile(null); setImportDelimiter(""); setForceCustomConfig(false); }}
                    className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={processPendingFile}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    Import Data
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EMPTY STATE / DRAG DROP */}
        {data.length === 0 ? (
          <div 
            className={`h-full flex flex-col items-center justify-center p-8 transition-colors ${dragActive ? 'bg-indigo-50/50' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {loading ? (
              <div className="flex flex-col items-center animate-pulse">
                <div className="h-12 w-12 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin mb-4"></div>
                <p className="text-lg font-medium text-slate-600">{loadingMsg}</p>
                <p className="text-sm text-slate-400">Large Parquet files may take a moment</p>
              </div>
            ) : (
              <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-12 text-center">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Upload size={32} strokeWidth={2.5} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Drop your data here</h2>
                <p className="text-slate-500 mb-8">
                  Support for <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">.csv</span>, <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">.parquet</span>, and <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">.json</span> files.
                </p>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-slate-500">Or select a file</span>
                  </div>
                </div>

                <div className="mt-6 flex flex-col items-center gap-4">
                  <div>
                    <input 
                      type="file" 
                      id="file-upload" 
                      className="hidden" 
                      // accept=".csv,.parquet,.json" // Removed strictly to allow custom extensions
                      onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0])}
                    />
                    <label 
                      htmlFor="file-upload"
                      className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold transition-transform active:scale-95 shadow-md"
                    >
                      Browse Files
                    </label>
                  </div>

                  {/* Custom Import Button */}
                  <button 
                    type="button"
                    onClick={() => {
                        setForceCustomConfig(true);
                        // Short timeout to let state update before triggering file dialog
                        setTimeout(() => document.getElementById('file-upload').click(), 50);
                    }}
                    className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors"
                  >
                    <Settings size={14} />
                    Custom Import Options?
                  </button>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Tip: Select any file type. If the extension is unknown, you'll see options to configure delimiters.
                  </p>
                </div>

                {error && (
                  <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 text-left">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* DATA GRID VIEW */
          <div className="h-full flex flex-col">
            
            {/* OVERLAY LOADING SPINNER (FOR EXPORTS) */}
            {loading && (
              <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center flex-col">
                 <div className="h-12 w-12 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin mb-4"></div>
                 <p className="text-lg font-bold text-slate-800">{loadingMsg}</p>
              </div>
            )}

            {/* TOOLBAR */}
            <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between gap-4">
               <div className="relative flex-1 max-w-md">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                 <input 
                   type="text" 
                   aria-label="Search data"
                   placeholder="Search data..." 
                   value={searchTerm}
                   onChange={(e) => {
                     setSearchTerm(e.target.value);
                     setCurrentPage(1);
                   }}
                   className="w-full pl-10 pr-4 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                 />
               </div>

               <div className="flex items-center gap-3">
                 {/* Highlight Empty Cells Toggle */}
                 <button 
                   type="button"
                   onClick={() => setShowEmptyStats(!showEmptyStats)}
                   className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors 
                     ${showEmptyStats 
                       ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' 
                       : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                   title="Toggle empty cell highlighting"
                 >
                   {showEmptyStats ? <ToggleRight size={18} className="text-red-600" /> : <ToggleLeft size={18} />}
                   <span className="hidden sm:inline">Highlight Empty</span>
                 </button>
               </div>
            </div>

            {/* TABLE CONTAINER */}
            <div className="flex-1 overflow-auto bg-slate-50 relative">
              <div className="min-w-full inline-block align-middle">
                <div className="border-b border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th scope="col" className="w-16 px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider bg-slate-50 border-r border-slate-100">
                          #
                        </th>
                        {columns.map((col) => (
                          <th 
                            key={col} 
                            scope="col" 
                            onClick={() => handleSort(col)}
                            onMouseEnter={() => handleMouseEnterColumn(col)}
                            onMouseLeave={handleMouseLeaveColumn}
                            className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-r border-slate-200/60 cursor-pointer hover:bg-slate-100 transition-colors select-none relative group"
                          >
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  {col}
                                  {sortConfig.key === col && (
                                    sortConfig.direction === 'asc' 
                                      ? <ArrowUp size={14} className="text-indigo-600" />
                                      : <ArrowDown size={14} className="text-indigo-600" />
                                  )}
                                </div>
                                {/* Conditional rendering of empty stats based on toggle */}
                                {showEmptyStats && (
                                  <span className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 border border-red-100 transition-opacity ${emptyCellCounts[col] > 0 ? 'opacity-100' : 'opacity-0'}`}>
                                      {emptyCellCounts[col] > 0 ? emptyCellCounts[col] : 0} empty
                                  </span>
                                )}
                            </div>

                            {/* STATS TOOLTIP */}
                            {hoveredColumn === col && activeColumnStats && (
                                <div className="absolute top-full left-0 mt-2 w-auto min-w-[12rem] max-w-sm bg-white p-3 rounded-lg shadow-xl border border-slate-200 z-50 text-left animate-in fade-in zoom-in-95 duration-100 cursor-default">
                                    <div className="flex items-center justify-between text-slate-500 mb-2">
                                        <div className="flex items-center gap-2">
                                            <Calculator size={14} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">
                                                {activeColumnStats.type} Stats
                                            </h4>
                                        </div>
                                        
                                        {/* COPY BUTTON */}
                                        <button
                                            type="button"
                                            onClick={handleCopyStats}
                                            className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-indigo-600 cursor-pointer"
                                            title="Copy stats to clipboard"
                                        >
                                            {copiedColumn === col ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                    <div className="space-y-1.5 text-xs text-slate-700 whitespace-nowrap">
                                        <div className="flex justify-between gap-4 border-b border-slate-100 pb-1">
                                            <span>Count ({activeColumnStats.type}):</span> 
                                            <span className="font-mono font-medium">{activeColumnStats.count}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span>Mean:</span> 
                                            <span className="font-mono font-medium">{activeColumnStats.mean}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span>Median:</span> 
                                            <span className="font-mono font-medium">{activeColumnStats.median}</span>
                                        </div>
                                        {activeColumnStats.type === 'Date' ? (
                                            <>
                                                <div className="flex justify-between gap-4">
                                                    <span>Oldest:</span> 
                                                    <span className="font-mono font-medium">{activeColumnStats.min}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span>Newest:</span> 
                                                    <span className="font-mono font-medium">{activeColumnStats.max}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between gap-4">
                                                <span>Mode:</span> 
                                                <span className="font-mono font-medium truncate max-w-[150px] text-right" title={activeColumnStats.mode}>{activeColumnStats.mode}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {currentRows.map((row, rIdx) => {
                        // Calculate the absolute index in the sorted array to update state correctly
                        const globalIndex = (currentPage - 1) * rowsPerPage + rIdx;
                        return (
                          <tr key={rIdx} className="hover:bg-slate-50 group transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400 font-mono bg-slate-50/50 border-r border-slate-100">
                              {globalIndex + 1}
                            </td>
                            {columns.map((col, cIdx) => {
                              const cellValue = row[col];
                              // Only calculate empty status if toggle is ON
                              const isEmpty = showEmptyStats && (cellValue === null || cellValue === undefined || cellValue === '');

                              return (
                                <td 
                                  key={`${rIdx}-${cIdx}`} 
                                  className="px-0 py-0 whitespace-nowrap border-r border-slate-100 min-w-[150px] relative"
                                >
                                  <input
                                    type="text"
                                    className={`w-full h-full px-6 py-3 text-sm text-slate-700 outline-none truncate transition-colors
                                      ${isEmpty ? 'bg-red-100/50' : 'bg-transparent'} 
                                      focus:bg-white focus:ring-2 focus:ring-inset focus:ring-indigo-500`}
                                    value={cellValue || ''}
                                    // Updating logic needs to find original index in 'data' array
                                    // For simplicity in this demo, we update filtered/sorted view,
                                    // but a real app would need a stable ID to map back to 'data'.
                                    // Here we search 'data' for the object reference.
                                    onChange={(e) => {
                                        const newValue = e.target.value;
                                        const rowIndexInData = data.indexOf(row);
                                        if (rowIndexInData > -1) {
                                            const newData = [...data];
                                            newData[rowIndexInData] = { ...newData[rowIndexInData], [col]: newValue };
                                            setData(newData);
                                        }
                                    }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {currentRows.length === 0 && (
                        <tr>
                          <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-slate-400">
                             No matching records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* PAGINATION */}
            <div className="bg-white border-t border-slate-200 p-3 flex flex-col sm:flex-row items-center justify-between shadow-lg z-10 gap-4 sm:gap-0">
               {/* Left side: Rows per page + Info */}
               <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="hidden xs:inline">Rows:</span>
                      <select
                          aria-label="Rows per page"
                          value={rowsPerPage}
                          onChange={(e) => {
                              setRowsPerPage(Number(e.target.value));
                              setCurrentPage(1);
                          }}
                          className="border border-slate-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                          {[50, 100, 250, 500, 1000].map(val => (
                              <option key={val} value={val}>{val}</option>
                          ))}
                      </select>
                  </div>
                  <div className="text-sm text-slate-500 hidden sm:block">
                      <span className="font-medium text-slate-900">{((currentPage - 1) * rowsPerPage) + 1}</span> - <span className="font-medium text-slate-900">{Math.min(currentPage * rowsPerPage, filteredData.length)}</span> of <span className="font-medium text-slate-900">{filteredData.length}</span>
                  </div>
               </div>

               {/* Right side: Navigation */}
               <div className="flex items-center gap-1 sm:gap-2">
                 <button 
                   type="button"
                   onClick={() => setCurrentPage(1)} 
                   disabled={currentPage === 1}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                   title="First Page"
                 >
                   <ChevronsLeft size={18} />
                 </button>
                 <button 
                   type="button"
                   onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                   disabled={currentPage === 1}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                   title="Previous Page"
                 >
                   <ChevronLeft size={18} />
                 </button>

                 <span className="flex items-center gap-2 text-sm text-slate-600 mx-2">
                    <span className="hidden xs:inline">Page</span>
                    <input
                        aria-label="Page number"
                        type="number"
                        min="1"
                        max={totalPages}
                        value={currentPage}
                        onChange={(e) => {
                            const val = e.target.value;
                            // Allow user to clear input while typing
                            if (val === '') return; 
                            const num = Number(val);
                            if (!isNaN(num) && num >= 1 && num <= totalPages) {
                                setCurrentPage(num);
                            }
                        }}
                        // Use onBlur to handle empty state reset if needed, or keeping last valid
                        onBlur={(e) => {
                            if (e.target.value === '') setCurrentPage(1);
                        }}
                        className="w-12 sm:w-16 border border-slate-300 rounded px-1 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span>of {totalPages}</span>
                 </span>

                 <button 
                   type="button"
                   onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                   disabled={currentPage === totalPages || totalPages === 0}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                   title="Next Page"
                 >
                   <ChevronRight size={18} />
                 </button>
                 <button 
                   type="button"
                   onClick={() => setCurrentPage(totalPages)}
                   disabled={currentPage === totalPages || totalPages === 0}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                   title="Last Page"
                 >
                   <ChevronsRight size={18} />
                 </button>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER INFO */}
      {data.length === 0 && (
         <footer className="bg-slate-50 py-6 text-center text-slate-400 text-sm">
           <div className="flex items-center justify-center gap-2 mb-1">
             <Info size={14} />
             <span>Data stays in your browser. No server uploads.</span>
           </div>
           Powered by PapaParse & HyParquet
         </footer>
      )}
    </div>
  );
}