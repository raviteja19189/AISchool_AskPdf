
"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
  id: string;
  type?: 'text' | 'chart';
  chartData?: any;
}

type Tab = 'chat' | 'insights';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [pdfText, setPdfText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<string>('');
  const [userInput, setUserInput] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isTyping, activeTab]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [userInput]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const extractTextFromPdf = async (file: File) => {
    const pdfLib = (window as any).pdfjsLib;
    if (!pdfLib) {
      throw new Error('PDF analysis library failed to load. Please refresh the page.');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        fullText += strings.join(' ') + '\n';
      }
      return fullText.trim();
    } catch (err) {
      console.error('PDF extraction failed:', err);
      throw new Error('Could not parse PDF. It might be password protected or corrupted.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Only PDF files are supported.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setFileName(file.name);
    setFileSize(formatFileSize(file.size));

    try {
      const text = await extractTextFromPdf(file);
      if (!text || text.length < 10) {
        throw new Error("This PDF seems to have very little extractable text.");
      }
      setPdfText(text);
      setMessages([{
        id: 'initial',
        role: 'model',
        content: `Hi! I've analyzed **${file.name}**. You can chat with it here, or switch to **Insights** to visualize data.`,
        timestamp: new Date(),
        type: 'text'
      }]);
    } catch (err: any) {
      setError(err.message);
      setFileName('');
      setPdfText(null);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || !pdfText || isTyping) return;

    const currentInput = userInput.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
      type: 'text'
    };

    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsTyping(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      let prompt = "";
      let config: any = {
        model: 'gemini-3-flash-preview',
      };

      if (activeTab === 'insights') {
        prompt = `
          Extract numerical data, trends, or comparisons from the following text and format it for a chart visualization.
          Return ONLY a JSON object that matches this structure:
          {
            "type": "bar" | "line" | "pie",
            "title": "A descriptive title",
            "labels": ["Label 1", "Label 2", ...],
            "datasets": [
              {
                "label": "Metric Name",
                "data": [10, 20, ...]
              }
            ],
            "explanation": "A short sentence explaining what this chart shows."
          }

          DOCUMENT CONTENT:
          """
          ${pdfText}
          """
          
          USER ANALYSIS REQUEST:
          ${currentInput}
        `;
        config.config = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              title: { type: Type.STRING },
              labels: { type: Type.ARRAY, items: { type: Type.STRING } },
              datasets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    data: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                  }
                }
              },
              explanation: { type: Type.STRING }
            },
            required: ["type", "title", "labels", "datasets", "explanation"]
          }
        };
      } else {
        prompt = `
          Answer the user's question based on the document.
          DOCUMENT CONTENT:
          """
          ${pdfText}
          """
          USER QUESTION:
          ${currentInput}
        `;
      }

      const response = await ai.models.generateContent({
        ...config,
        contents: prompt,
      });

      const responseText = response.text || "";
      let modelMessage: Message;

      if (activeTab === 'insights') {
        try {
          const chartData = JSON.parse(responseText);
          modelMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            content: chartData.explanation,
            timestamp: new Date(),
            type: 'chart',
            chartData: chartData
          };
        } catch (e) {
          modelMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            content: responseText,
            timestamp: new Date(),
            type: 'text'
          };
        }
      } else {
        modelMessage = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          content: responseText,
          timestamp: new Date(),
          type: 'text'
        };
      }

      setMessages(prev => [...prev, modelMessage]);
    } catch (err: any) {
      console.error('Gemini API Error:', err);
      setError(err.message || 'Failed to get a response.');
    } finally {
      setIsTyping(false);
    }
  };

  const resetApp = () => {
    setPdfText(null);
    setFileName('');
    setMessages([]);
    setError(null);
    setUserInput('');
    setActiveTab('chat');
  };

  const renderChart = (chartData: any) => {
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' as const },
        title: { display: true, text: chartData.title },
      },
    };

    const colors = [
      'rgba(99, 102, 241, 0.6)',
      'rgba(16, 185, 129, 0.6)',
      'rgba(245, 158, 11, 0.6)',
      'rgba(239, 68, 68, 0.6)',
      'rgba(139, 92, 246, 0.6)',
    ];

    const data = {
      labels: chartData.labels,
      datasets: chartData.datasets.map((ds: any, idx: number) => ({
        ...ds,
        backgroundColor: chartData.type === 'pie' ? colors : colors[idx % colors.length],
        borderColor: chartData.type === 'pie' ? '#fff' : colors[idx % colors.length].replace('0.6', '1'),
        borderWidth: 1,
      })),
    };

    return (
      <div className="chart-container-wrapper">
        <div className="chart-canvas-box">
          {chartData.type === 'bar' && <Bar options={options} data={data} />}
          {chartData.type === 'line' && <Line options={options} data={data} />}
          {chartData.type === 'pie' && <Pie options={options} data={data} />}
        </div>
      </div>
    );
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>AskPdf</h1>
            <span>AI Analyst</span>
          </div>
        </div>

        <nav className="side-nav">
          {pdfText && (
            <div className="document-card">
              <div className="doc-icon">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
              </div>
              <div className="doc-details">
                <p className="doc-name">{fileName}</p>
                <p className="doc-size">{fileSize}</p>
              </div>
              <button className="reset-btn" onClick={resetApp} title="Upload new document">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
              </button>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <p>Powered by Gemini 3 Flash</p>
        </div>
      </aside>

      <main className="chat-viewport">
        {!pdfText && !isProcessing ? (
          <section className="welcome-screen">
            <div className="hero-content">
              <div className="hero-icon-stack">
                <div className="blob"></div>
                <svg className="main-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <h2>Analyze with visuals</h2>
              <p>Upload a PDF to chat, extract metrics, and generate interactive charts from your document's data.</p>
              
              <div className="upload-actions">
                <label className="cta-button">
                  Upload PDF
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    className="hidden" 
                    accept=".pdf" 
                    onChange={handleFileUpload} 
                  />
                </label>
              </div>
              {error && <div className="error-alert">{error}</div>}
            </div>
          </section>
        ) : (
          <section className="chat-interface">
            <header className="chat-header">
              <div className="tabs-switcher">
                <button 
                  className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setActiveTab('chat')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                  Chat
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'insights' ? 'active' : ''}`}
                  onClick={() => setActiveTab('insights')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10"></path><path d="M18 20V4"></path><path d="M6 20v-4"></path></svg>
                  Insights
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="messages-container">
              {isProcessing && (
                <div className="system-status">
                  <div className="spinner"></div>
                  <span>Extracting document metadata...</span>
                </div>
              )}
              
              {messages.filter(m => activeTab === 'insights' ? true : m.type !== 'chart').map((msg) => (
                <div key={msg.id} className={`message-row ${msg.role}`}>
                  <div className={`message-bubble ${msg.type === 'chart' ? 'chart-bubble' : ''}`}>
                    <div className="message-content">
                      {msg.type === 'chart' && msg.chartData ? (
                        <div className="chart-wrapper">
                          <h3 className="chart-title-main">{msg.chartData.title}</h3>
                          {renderChart(msg.chartData)}
                          <p className="chart-explanation">{msg.content}</p>
                        </div>
                      ) : (
                        msg.content.split('\n').map((line, idx) => (
                          <p key={idx} className={line.startsWith('- ') || line.startsWith('* ') ? 'list-item' : ''}>
                            {line}
                          </p>
                        ))
                      )}
                    </div>
                    <span className="timestamp">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="message-row model">
                  <div className="message-bubble typing">
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <footer className="input-bar">
              <div className="input-wrapper">
                <textarea
                  ref={inputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={activeTab === 'insights' ? "Ask to visualize something (e.g. 'Show me a bar chart of the budget')..." : "Ask a question about the document..."}
                  rows={1}
                />
                <button 
                  className="send-btn" 
                  onClick={handleSendMessage}
                  disabled={!userInput.trim() || isTyping || !pdfText}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}
