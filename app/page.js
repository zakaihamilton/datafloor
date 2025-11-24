"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Download, 
  Trash2, 
  Save, 
  FileType, 
  AlertCircle,
  Database,
  ArrowRightLeft,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Info
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
    // FIX: Use 'new Function' to completely hide the import from Webpack/Next.js.
    // This forces the browser to handle the dynamic import at runtime, preventing the
    // "Cannot find module" build error.
    const importFn = new Function('url', 'return import(url)');
    const module = await importFn(url);
    return module;
  } catch (e) {
    console.error("Failed to load module:", url, e);
    return null;
  }
};

// -- APP COMPONENT --

export default function DataFloor() {
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [fileName, setFileName] = useState("Untitled");
  const [fileType, setFileType] = useState(null); // 'csv' or 'parquet'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Libraries refs
  const papaRef = useRef(null);
  const hyparquetRef = useRef(null);

  useEffect(() => {
    // Initialize Libraries
    const init = async () => {
      try {
        // Load PapaParse for CSV
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js');
        papaRef.current = window.Papa;

        // Load HyParquet for Parquet Reading
        // Using +esm ensures we get the ES Module version
        const hyparquet = await loadModule('https://cdn.jsdelivr.net/npm/hyparquet/+esm');
        hyparquetRef.current = hyparquet;
        
      } catch (err) {
        console.error(err);
        setError("Failed to initialize data libraries. Please refresh.");
      }
    };
    init();
  }, []);

  // -- FILE HANDLING --

  const handleFileUpload = async (file) => {
    setLoading(true);
    setError(null);
    setFileName(file.name);
    
    try {
      if (file.name.endsWith('.csv')) {
        setFileType('csv');
        parseCSV(file);
      } else if (file.name.endsWith('.parquet')) {
        setFileType('parquet');
        await parseParquet(file);
      } else {
        throw new Error("Unsupported file format. Please use .csv or .parquet");
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const parseCSV = (file) => {
    if (!papaRef.current) return;
    papaRef.current.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          setColumns(Object.keys(results.data[0]));
          setData(results.data);
        }
        setLoading(false);
      },
      error: (err) => {
        setError("Error parsing CSV: " + err.message);
        setLoading(false);
      }
    });
  };

  const parseParquet = async (file) => {
    if (!hyparquetRef.current) {
      setError("Parquet library not loaded. Please refresh.");
      setLoading(false);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Use hyparquet to read the file
      await hyparquetRef.current.parquetRead({
        file: arrayBuffer,
        rowFormat: 'object',
        onComplete: (rows) => {
          if (rows.length > 0) {
            // Extract columns from the first row
            const firstRow = rows[0];
            const cols = Object.keys(firstRow);
            setColumns(cols);
            
            // Sanitize rows (convert objects/arrays to strings for display)
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

  const exportCSV = () => {
    if (!papaRef.current) return;
    const csv = papaRef.current.unparse(data);
    downloadFile(csv, fileName.replace(/\.[^/.]+$/, "") + "_exported.csv", 'text/csv');
  };

  const exportParquet = () => {
    const confirm = window.confirm(
      "Client-side Parquet encoding is experimental and requires WebAssembly.\n\n" +
      "If this fails, would you like to download as JSON instead? (JSON is widely compatible with Parquet tools)"
    );

    if (confirm) {
      const jsonStr = JSON.stringify(data, null, 2);
      downloadFile(jsonStr, fileName.replace(/\.[^/.]+$/, "") + "_exported.json", 'application/json');
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

  const filteredData = data.filter(row => 
    Object.values(row).some(val => 
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const currentRows = filteredData.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans">
      
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white">
            <Database size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">DataFloor</h1>
            <p className="text-xs text-slate-500 font-medium">Parquet ⇄ CSV Converter & Editor</p>
          </div>
        </div>

        {data.length > 0 && (
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                <FileType size={14} className="text-slate-500"/>
                <span className="text-sm font-semibold text-slate-700">{fileType ? fileType.toUpperCase() : 'UNKNOWN'}</span>
                <span className="text-slate-300">|</span>
                <span className="text-sm text-slate-500">{data.length.toLocaleString()} rows</span>
             </div>
             
             <div className="h-6 w-px bg-slate-200 mx-2"></div>

             <button 
               onClick={exportCSV}
               className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-medium transition-colors"
             >
               <Download size={16} />
               Export CSV
             </button>
             
             <button 
               onClick={exportParquet}
               className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
             >
               <ArrowRightLeft size={16} />
               Export Parquet
             </button>
          </div>
        )}
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-hidden relative">
        
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
                <p className="text-lg font-medium text-slate-600">Processing Data...</p>
                <p className="text-sm text-slate-400">Large Parquet files may take a moment</p>
              </div>
            ) : (
              <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-12 text-center">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Upload size={32} strokeWidth={2.5} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Drop your data here</h2>
                <p className="text-slate-500 mb-8">
                  Support for <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">.csv</span> and <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">.parquet</span> files.
                </p>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-slate-500">Or select a file</span>
                  </div>
                </div>

                <div className="mt-6">
                  <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    accept=".csv,.parquet"
                    onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0])}
                  />
                  <label 
                    htmlFor="file-upload"
                    className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold transition-transform active:scale-95"
                  >
                    Browse Files
                  </label>
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
            {/* TOOLBAR */}
            <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between gap-4">
               <div className="relative flex-1 max-w-md">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                 <input 
                   type="text" 
                   placeholder="Search data..." 
                   value={searchTerm}
                   onChange={(e) => {
                     setSearchTerm(e.target.value);
                     setCurrentPage(1);
                   }}
                   className="w-full pl-10 pr-4 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                 />
               </div>

               <div className="flex items-center gap-2">
                 <button 
                   onClick={() => {
                     setData([]);
                     setColumns([]);
                     setFileName("Untitled");
                     setFileType(null);
                     setSearchTerm("");
                   }}
                   className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                   title="Clear Data"
                 >
                   <Trash2 size={18} />
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
                            className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-r border-slate-200/60"
                          >
                            <div className="flex items-center gap-2">
                              {col}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {currentRows.map((row, rIdx) => {
                        const globalIndex = (currentPage - 1) * rowsPerPage + rIdx + 1;
                        return (
                          <tr key={rIdx} className="hover:bg-slate-50 group transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400 font-mono bg-slate-50/50 border-r border-slate-100">
                              {globalIndex}
                            </td>
                            {columns.map((col, cIdx) => (
                              <td 
                                key={`${rIdx}-${cIdx}`} 
                                className="px-0 py-0 whitespace-nowrap border-r border-slate-100 min-w-[150px] relative"
                              >
                                <input
                                  type="text"
                                  className="w-full h-full px-6 py-3 bg-transparent border-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-sm text-slate-700 outline-none truncate"
                                  value={row[col] || ''}
                                  onChange={(e) => updateCell(rIdx, col, e.target.value)}
                                />
                              </td>
                            ))}
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
            <div className="bg-white border-t border-slate-200 p-3 flex items-center justify-between shadow-lg z-10">
               <div className="text-sm text-slate-500">
                 Showing <span className="font-medium text-slate-900">{((currentPage - 1) * rowsPerPage) + 1}</span> to <span className="font-medium text-slate-900">{Math.min(currentPage * rowsPerPage, filteredData.length)}</span> of <span className="font-medium text-slate-900">{filteredData.length}</span> results
               </div>
               <div className="flex items-center gap-2">
                 <button 
                   onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                   disabled={currentPage === 1}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                 >
                   <ChevronLeft size={18} />
                 </button>
                 <span className="text-sm font-medium text-slate-700 px-2">
                   Page {currentPage} of {Math.max(totalPages, 1)}
                 </span>
                 <button 
                   onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                   disabled={currentPage === totalPages || totalPages === 0}
                   className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 transition-colors"
                 >
                   <ChevronRight size={18} />
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