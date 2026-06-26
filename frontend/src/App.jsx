import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Play, 
  Terminal as TerminalIcon, 
  Code2, 
  Activity, 
  Cpu, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Server,
  Layers,
  ChevronRight
} from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/clerk-react';

const DEFAULT_STARTERS = {
  javascript: `// JavaScript Starter Template
// Read input from standard input if needed.
const fs = require('fs');

function main() {
    const input = fs.readFileSync('/dev/stdin', 'utf-8').trim();
    if (!input) return;
    
    // Write your solution here
    console.log(input);
}
main();`,
  python: `# Python Starter Template
import sys

def main():
    # Read all input from standard input
    input_data = sys.stdin.read().trim()
    if not input_data:
        return
        
    # Write your solution here
    print(input_data)

if __name__ == '__main__':
    main()`,
  cpp: `// C++ Starter Template
#include <iostream>
#include <string>
using namespace std;

int main() {
    // Fast I/O
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    string input;
    if (getline(cin, input)) {
        // Write your solution here
        cout << input << "\\n";
    }
    return 0;
}`,
  java: `// Java Starter Template
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        if (sc.hasNextLine()) {
            String input = sc.nextLine();
            // Write your solution here
            System.out.println(input);
        }
    }
}`
};

export default function App() {
  const [problems, setProblems] = useState([]);
  const [selectedProblemId, setSelectedProblemId] = useState(null);
  const [problemDetail, setProblemDetail] = useState(null);
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState('');
  
  // Clerk hooks
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState('description');
  const [submissionsHistory, setSubmissionsHistory] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Service health states
  const [servicesHealth, setServicesHealth] = useState({
    admin: 'loading',
    submission: 'loading',
    socket: 'loading',
    user: 'loading',
  });

  // Submission & socket monitoring states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [socketStatus, setSocketStatus] = useState('disconnected');
  const [finalStatus, setFinalStatus] = useState(null);

  const logsEndRef = useRef(null);
  const socketRef = useRef(null);

  // 1. Check services health
  const checkHealth = async () => {
    setServicesHealth({ admin: 'loading', submission: 'loading', socket: 'loading', user: 'loading' });
    
    // Admin Service
    try {
      const res = await fetch('http://localhost:3001/health');
      setServicesHealth(prev => ({ ...prev, admin: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, admin: 'offline' }));
    }

    // Submission Service
    try {
      const res = await fetch('http://localhost:3003/health');
      setServicesHealth(prev => ({ ...prev, submission: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, submission: 'offline' }));
    }

    // Socket Service
    try {
      const res = await fetch('http://localhost:3004/health');
      setServicesHealth(prev => ({ ...prev, socket: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, socket: 'offline' }));
    }

    // User Service
    try {
      const res = await fetch('http://localhost:3005/health');
      setServicesHealth(prev => ({ ...prev, user: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, user: 'offline' }));
    }
  };

  // 2. Fetch problems on mount
  useEffect(() => {
    checkHealth();
    fetchProblems();
  }, []);

  const fetchProblems = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/problems/all');
      if (res.ok) {
        const data = await res.json();
        setProblems(data);
        if (data.length > 0) {
          setSelectedProblemId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch problems:', err);
      addLog('System', 'Failed to fetch problems list. Make sure Problem Admin Service is running on port 3001.', 'error');
    }
  };

  // Fetch submissions history for the signed-in user
  const fetchSubmissionsHistory = async () => {
    if (!userId) return;
    setLoadingSubmissions(true);
    try {
      const token = await getToken();
      const res = await fetch('http://localhost:3003/api/submissions/history', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSubmissionsHistory(data);
      }
    } catch (err) {
      console.error('[Frontend] Failed to fetch user submissions history:', err);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  // Load submissions history when tab is clicked or user log state changes
  useEffect(() => {
    if (userId && activeTab === 'submissions') {
      fetchSubmissionsHistory();
    }
  }, [userId, activeTab]);

  // 3. Fetch problem details when selected problem changes
  useEffect(() => {
    if (!selectedProblemId) return;

    const fetchProblemDetail = async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/problems/get/${selectedProblemId}`);
        if (res.ok) {
          const data = await res.json();
          setProblemDetail(data);
          
          // Try to load template from database for the current language
          const customSnippet = data.codeSnippets?.find(cs => cs.language === language);
          if (customSnippet) {
            setCode(customSnippet.codeTemplate);
          } else {
            setCode(DEFAULT_STARTERS[language]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch problem details:', err);
        addLog('System', 'Failed to load details for the selected problem.', 'error');
      }
    };

    fetchProblemDetail();
  }, [selectedProblemId]);

  // 4. Update code template when language changes
  useEffect(() => {
    if (!problemDetail) {
      setCode(DEFAULT_STARTERS[language]);
      return;
    }
    const customSnippet = problemDetail.codeSnippets?.find(cs => cs.language === language);
    if (customSnippet) {
      setCode(customSnippet.codeTemplate);
    } else {
      setCode(DEFAULT_STARTERS[language]);
    }
  }, [language, problemDetail]);

  // 5. Scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (sender, message, type = 'info') => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      sender,
      message,
      type
    }]);
  };

  // Handle Tab key inside editor
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const val = e.target.value;
      const newVal = val.substring(0, start) + '    ' + val.substring(end);
      setCode(newVal);
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 4;
      }, 0);
    }
  };

  // 6. Submit code and connect to Socket.IO
  const handleSubmit = async (isRunOnly = false) => {
    if (!selectedProblemId || !code.trim() || isSubmitting) return;
    if (!userId) {
      addLog('System', 'You must be signed in to submit code.', 'error');
      return;
    }

    setIsSubmitting(true);
    setFinalStatus(null);
    setLogs([]); // clear logs
    addLog('System', `Submitting code solution to ${isRunOnly ? 'Run Queue (sample cases only)' : 'Submit Queue (all cases)'}...`, 'info');

    try {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token could not be retrieved. Please sign in.');
      }

      // POST to Submission Service (Port 3003)
      const res = await fetch('http://localhost:3003/api/submissions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          problemId: selectedProblemId,
          code,
          language,
          isRunOnly,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to submit code');
      }

      const submission = await res.json();
      const submissionId = submission.id;
      addLog('System', `Submission created! ID: ${submissionId.substring(0, 8)}...`, 'success');
      addLog('System', 'Connecting to real-time events socket...', 'info');

      // Initialize Socket connection
      setupSocketConnection(submissionId);

    } catch (err) {
      console.error(err);
      addLog('System', `Submission failed: ${err.message}`, 'error');
      setIsSubmitting(false);
    }
  };

  const setupSocketConnection = (submissionId) => {
    // Connect to Socket Service (Port 3004)
    const socket = io('http://localhost:3004', {
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketStatus('connected');
      addLog('Socket', 'Connected to broker. Subscribing to updates...', 'info');
      // Join room for this submission
      socket.emit('joinSubmission', submissionId);
    });

    socket.on('connect_error', (err) => {
      setSocketStatus('error');
      addLog('Socket', `Connection failed: ${err.message}`, 'error');
      cleanupSocket();
      setIsSubmitting(false);
    });

    // Listen for status updates
    socket.on('submission:status', (data) => {
      const { status, executionTime, executionMemory, errorDetails } = data;
      
      if (status === 'RUNNING') {
        addLog('Evaluator', 'State updated: RUNNING (compiling and executing test cases inside Docker)...', 'warning');
      } else {
        // Final state reached
        setFinalStatus(status);
        if (status === 'ACCEPTED') {
          addLog('Evaluator', 'SUCCESS: All test cases passed! Status: ACCEPTED ✅', 'success');
          if (executionTime !== undefined) {
            addLog('Evaluator', `Max Execution Time: ${executionTime} ms`, 'success');
          }
          if (executionMemory !== undefined) {
            addLog('Evaluator', `Mock Memory Usage: ${(executionMemory / 1024).toFixed(2)} MB`, 'success');
          }
        } else if (status === 'WRONG_ANSWER') {
          addLog('Evaluator', 'FAILED: Incorrect outputs detected. Status: WRONG_ANSWER ❌', 'error');
          if (errorDetails) {
            addLog('Sandbox', errorDetails, 'error');
          }
        } else if (status === 'COMPILATION_ERROR') {
          addLog('Evaluator', 'FAILED: Code compilation failed. Status: COMPILATION_ERROR ❌', 'error');
          if (errorDetails) {
            addLog('Compiler', errorDetails, 'error');
          }
        } else if (status === 'TIME_LIMIT_EXCEEDED') {
          addLog('Evaluator', 'FAILED: Solution exceeded the time limit. Status: TIME_LIMIT_EXCEEDED ⏳', 'error');
        } else {
          addLog('Evaluator', `FAILED: Status: ${status} ❌`, 'error');
          if (errorDetails) {
            addLog('Sandbox', errorDetails, 'error');
          }
        }

        // Close connection once terminal state is received
        cleanupSocket();
        setIsSubmitting(false);
        // Refresh submissions history list
        fetchSubmissionsHistory();
      }
    });

    socket.on('disconnect', () => {
      setSocketStatus('disconnected');
      addLog('Socket', 'Disconnected from events stream.', 'info');
    });
  };

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  // Clean up socket on unmount
  useEffect(() => {
    return () => cleanupSocket();
  }, []);

  // Helper lines for editor lines count
  const linesArray = Array.from({ length: Math.max(code.split('\n').length, 12) }, (_, i) => i + 1);

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans">
      
      {/* HEADER NAVBAR */}
      <header className="flex justify-between items-center px-6 py-3 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              Codexis
            </h1>
            <p className="text-xs text-slate-500 font-medium">Real-time Sandbox Judge</p>
          </div>
        </div>

        {/* Live Service Monitors */}
        <div className="flex items-center gap-6 text-sm bg-slate-950/60 border border-slate-800/80 px-4 py-1.5 rounded-xl">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-400 text-xs">Microservices:</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${servicesHealth.admin === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-slate-400">Admin</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${servicesHealth.submission === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-slate-400">Submission</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${servicesHealth.socket === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-slate-400">Socket</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${servicesHealth.user === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-slate-400">User</span>
          </div>

          <button 
            onClick={checkHealth}
            className="hover:text-purple-400 text-slate-500 transition-colors duration-150 cursor-pointer"
            title="Refresh Status"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* User Auth Section */}
        <div className="flex items-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="text-xs font-bold px-4 py-1.5 rounded-lg border border-slate-700 hover:border-purple-500 hover:text-purple-400 text-slate-300 transition-all duration-250 cursor-pointer">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="text-xs font-bold px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md cursor-pointer">
                Sign Up
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <div className="flex items-center gap-3">
              {user && (
                <span className="text-xs text-slate-450 font-medium hidden md:inline">
                  Hello, <span className="text-slate-200 font-semibold">{user.username || user.firstName || 'Developer'}</span>
                </span>
              )}
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex flex-1 overflow-hidden p-4 gap-4 bg-slate-950">
        
        {/* SIDEBAR - PROBLEMS LIST */}
        <section className="w-72 bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Code2 className="w-4 h-4 text-purple-400" />
            Problems List
          </h2>
          
          <div className="flex flex-col gap-2">
            {problems.map((prob) => {
              const isSelected = prob.id === selectedProblemId;
              let diffBadgeColor = "text-emerald-400 bg-emerald-950/40 border-emerald-900/60";
              if (prob.difficulty === "Medium") {
                diffBadgeColor = "text-amber-400 bg-amber-950/40 border-amber-900/60";
              } else if (prob.difficulty === "Hard") {
                diffBadgeColor = "text-red-400 bg-red-950/40 border-red-900/60";
              }

              return (
                <button
                  key={prob.id}
                  onClick={() => !isSubmitting && setSelectedProblemId(prob.id)}
                  disabled={isSubmitting}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'bg-purple-950/20 border-purple-500/50 shadow-md shadow-purple-500/5 text-white'
                      : 'bg-slate-950/30 border-slate-800/80 text-slate-300 hover:bg-slate-800/20 hover:border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <span className="font-semibold text-sm line-clamp-1 flex-1">{prob.title}</span>
                    <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'translate-x-0.5 text-purple-400' : 'text-slate-600'}`} />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold ${diffBadgeColor}`}>
                      {prob.difficulty}
                    </span>
                    <span className="text-[10px] text-slate-500 line-clamp-1">{prob.tags}</span>
                  </div>
                </button>
              );
            })}

            {problems.length === 0 && (
              <div className="text-center py-8 text-slate-600 text-sm">
                No problems found. Seed the database first!
              </div>
            )}
          </div>
        </section>

        {/* WORKSPACE AREA (Left: Description, Right: Editor + Logs) */}
        <section className="flex-1 flex gap-4 overflow-hidden">
           {/* PROBLEM DETAILS & SUBMISSIONS TABBED COLUMN */}
          <div className="flex-1 bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
            {problemDetail ? (
              <>
                {/* Tab selector */}
                <div className="flex border-b border-slate-800 bg-slate-950/40 shrink-0">
                  <button 
                    className={`px-6 py-3 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all duration-200 ${
                      activeTab === 'description' 
                        ? 'border-purple-500 text-white bg-slate-900/40' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setActiveTab('description')}
                  >
                    Description
                  </button>
                  <button 
                    className={`px-6 py-3 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all duration-200 ${
                      activeTab === 'submissions' 
                        ? 'border-purple-500 text-white bg-slate-900/40' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setActiveTab('submissions')}
                  >
                    My Submissions
                  </button>
                </div>

                {/* Tab content area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                  {activeTab === 'description' ? (
                    <>
                      <div>
                        <h2 className="text-2xl font-extrabold text-white mb-2">{problemDetail.title}</h2>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`text-xs px-2.5 py-0.5 rounded-md border font-bold ${
                            problemDetail.difficulty === 'Easy' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/50' :
                            problemDetail.difficulty === 'Medium' ? 'text-amber-400 bg-amber-950/30 border-amber-900/50' :
                            'text-red-400 bg-red-950/30 border-red-900/50'
                          }`}>
                            {problemDetail.difficulty}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Activity className="w-3.5 h-3.5 text-slate-500" />
                            <span>{problemDetail.timeLimit} ms Limit</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Cpu className="w-3.5 h-3.5 text-slate-500" />
                            <span>{problemDetail.memoryLimit} MB Limit</span>
                          </div>
                        </div>
                      </div>

                      <hr className="border-slate-800" />

                      {/* Problem Description (sanitized HTML) */}
                      <div 
                        className="prose prose-invert prose-sm max-w-none text-slate-350 leading-relaxed space-y-4"
                        dangerouslySetInnerHTML={{ __html: problemDetail.renderedDescription }}
                      />

                      {/* Sample Testcases */}
                      {problemDetail.testcases && problemDetail.testcases.filter(tc => tc.isSample).length > 0 && (
                        <div className="flex flex-col gap-4 mt-2">
                          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Sample Test Cases</h3>
                          {problemDetail.testcases.filter(tc => tc.isSample).map((tc, idx) => (
                            <div key={tc.id} className="grid grid-cols-2 gap-4">
                              <div className="flex flex-col gap-1.5">
                                <span className="text-xs text-slate-505 font-semibold">Sample Input {idx + 1}</span>
                                <pre className="bg-slate-950 border border-slate-850 p-3 rounded-lg text-xs font-mono overflow-x-auto text-slate-300 whitespace-pre-wrap">
                                  {tc.input}
                                </pre>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                <span className="text-xs text-slate-505 font-semibold">Expected Output {idx + 1}</span>
                                <pre className="bg-slate-950 border border-slate-850 p-3 rounded-lg text-xs font-mono overflow-x-auto text-slate-300 whitespace-pre-wrap">
                                  {tc.expectedOutput}
                                </pre>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    // Submissions History Tab
                    <div className="flex-1 flex flex-col gap-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">My Submissions History</h3>
                      
                      {!userId ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-12">
                          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-slate-505" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white mb-1">Authentication Required</h4>
                            <p className="text-xs text-slate-505 max-w-xs leading-relaxed">
                              Sign in to your Codexis account to track and view your full submissions history.
                            </p>
                          </div>
                          <SignInButton mode="modal">
                            <button className="text-xs font-bold px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white cursor-pointer shadow-md shadow-purple-950/20">
                              Sign In
                            </button>
                          </SignInButton>
                        </div>
                      ) : loadingSubmissions ? (
                        <div className="flex-1 flex items-center justify-center py-12 text-slate-505 text-xs gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-purple-500" />
                          <span>Loading your submission history...</span>
                        </div>
                      ) : submissionsHistory.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-12 text-slate-505 text-xs">
                          <Code2 className="w-6 h-6 opacity-30" />
                          <span>You haven't submitted any solutions yet.</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 overflow-y-auto pr-1 max-h-[calc(100vh-270px)]">
                          {submissionsHistory.map((sub) => {
                            let statusColor = "text-yellow-400 bg-yellow-950/20 border-yellow-900/50";
                            if (sub.status === "ACCEPTED") {
                              statusColor = "text-emerald-400 bg-emerald-950/20 border-emerald-900/50";
                            } else if (
                              sub.status === "WRONG_ANSWER" || 
                              sub.status === "RUNTIME_ERROR" || 
                              sub.status === "COMPILATION_ERROR" || 
                              sub.status === "TIME_LIMIT_EXCEEDED"
                            ) {
                              statusColor = "text-red-450 bg-red-950/20 border-red-900/50";
                            }
                            return (
                              <div key={sub.id} className="bg-slate-950/30 border border-slate-850/70 hover:border-slate-805 rounded-xl p-3.5 flex flex-col gap-2 transition-colors duration-150">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h4 className="font-bold text-xs text-white">{sub.problem?.title || 'Problem'}</h4>
                                    <span className="text-[10px] text-slate-550 font-medium">
                                      {new Date(sub.createdAt).toLocaleString()}
                                    </span>
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${statusColor}`}>
                                    {sub.status}
                                  </span>
                                </div>
                                
                                <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-900/60 pt-2">
                                  <span className="font-mono bg-slate-900/80 border border-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                                    {sub.language}
                                  </span>
                                  <div className="flex gap-3 text-slate-550 font-medium">
                                    {sub.executionTime !== null && (
                                      <span>Time: <strong className="text-slate-400 font-semibold">{sub.executionTime} ms</strong></span>
                                    )}
                                    {sub.executionMemory !== null && (
                                      <span>Mem: <strong className="text-slate-400 font-semibold">{(sub.executionMemory / 1024).toFixed(2)} MB</strong></span>
                                    )}
                                  </div>
                                </div>
                                {sub.errorDetails && (
                                  <pre className="text-[10px] font-mono bg-red-950/5 border border-red-950/20 p-2 rounded text-red-300 overflow-x-auto max-h-16 whitespace-pre-wrap leading-relaxed mt-1">
                                    {sub.errorDetails}
                                  </pre>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                Select a problem from the list to view its description.
              </div>
            )}
          </div>

          {/* CODE EDITOR & RUNTIME LOGS COLUMN */}
          <div className="w-[50%] flex flex-col gap-4 overflow-hidden">
            
            {/* EDITOR CONTAINER */}
            <div className="flex-1 bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
              
              {/* Editor Controls Header */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-950/60 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Solution Editor</span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Language Selector */}
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={isSubmitting}
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="javascript">JavaScript </option>
                    <option value="python">Python_3</option>
                    <option value="cpp">C++ </option>
                    <option value="java">Java 11</option>
                  </select>

                  {/* Run & Submit Buttons */}
                  {!userId ? (
                    <SignInButton mode="modal">
                      <div className="flex gap-2">
                        <button
                          className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border border-slate-700 hover:border-purple-500 hover:text-purple-400 text-slate-300 transition-all duration-200 cursor-pointer shadow-sm"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Run Code
                        </button>
                        <button
                          className="flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg text-white shadow-md transition-all duration-250 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 cursor-pointer shadow-purple-950/30"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" />
                          Sign in to Submit
                        </button>
                      </div>
                    </SignInButton>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSubmit(true)}
                        disabled={isSubmitting || !code.trim()}
                        className={`flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                          isSubmitting || !code.trim()
                            ? 'border-slate-800 text-slate-605 cursor-not-allowed shadow-none'
                            : 'border-slate-700 hover:border-purple-500 hover:text-purple-400 text-slate-300 shadow-sm'
                        }`}
                      >
                        {isSubmitting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        Run Code
                      </button>
                      <button
                        onClick={() => handleSubmit(false)}
                        disabled={isSubmitting || !code.trim()}
                        className={`flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg text-white shadow-md transition-all duration-200 ${
                          isSubmitting || !code.trim()
                            ? 'bg-slate-800 text-slate-500 shadow-none cursor-not-allowed'
                            : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 cursor-pointer shadow-purple-950/30'
                        }`}
                      >
                        {isSubmitting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-white" />
                        )}
                        {isSubmitting ? 'Evaluating...' : 'Submit Code'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Editor Code Area */}
              <div className="flex-1 flex font-mono text-sm relative overflow-hidden bg-slate-950/30">
                {/* Line Numbers */}
                <div className="select-none text-right pr-3 pl-4 py-4 bg-slate-950/50 border-r border-slate-900 text-slate-600 text-xs leading-6 min-w-10">
                  {linesArray.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>

                {/* Main Textarea */}
                <div className="flex-1 p-4 relative overflow-y-auto leading-6">
                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSubmitting}
                    spellCheck="false"
                    className="code-editor-textarea absolute inset-4"
                    placeholder="// Write your solution here..."
                  />
                </div>
              </div>
            </div>

            {/* REAL-TIME TERMINAL LOGS CONSOLE */}
            <div className="h-64 bg-slate-950 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
              
              {/* Terminal Title Header */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 border-b border-slate-800 select-none">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Evaluation Terminal Console</span>
                </div>
                
                {/* Connection Status Badge */}
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    socketStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                    socketStatus === 'error' ? 'bg-red-500' : 'bg-slate-600'
                  }`} />
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    {socketStatus}
                  </span>
                </div>
              </div>

              {/* Logs Screen */}
              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs leading-5 flex flex-col gap-1.5 bg-black/45 selection:bg-purple-900/30">
                {logs.map((log) => {
                  let senderStyle = "text-slate-400";
                  let msgStyle = "text-slate-300";

                  if (log.sender === 'System') {
                    senderStyle = "text-cyan-400";
                    msgStyle = "text-cyan-200/90";
                  } else if (log.sender === 'Socket') {
                    senderStyle = "text-indigo-400";
                    msgStyle = "text-indigo-200/90";
                  } else if (log.sender === 'Evaluator') {
                    if (log.type === 'success') {
                      senderStyle = "text-emerald-400 font-bold";
                      msgStyle = "text-emerald-200 font-medium";
                    } else if (log.type === 'error') {
                      senderStyle = "text-red-400 font-bold";
                      msgStyle = "text-red-300";
                    } else {
                      senderStyle = "text-yellow-500";
                      msgStyle = "text-yellow-200/90";
                    }
                  } else if (log.sender === 'Compiler' || log.sender === 'Sandbox') {
                    senderStyle = "text-rose-500 font-bold";
                    msgStyle = "bg-rose-950/20 border border-rose-950/60 p-3 rounded-lg text-rose-200/90 block w-full whitespace-pre-wrap overflow-x-auto mt-1";
                  }

                  return (
                    <div key={log.id} className="flex flex-col gap-0.5">
                      <div className="flex items-start gap-1.5">
                        <span className="text-[10px] text-slate-600 shrink-0 font-medium select-none">[{log.timestamp}]</span>
                        <span className={`${senderStyle} font-semibold shrink-0 select-none`}>[{log.sender}]</span>
                        {log.sender !== 'Compiler' && log.sender !== 'Sandbox' && (
                          <span className={msgStyle}>{log.message}</span>
                        )}
                      </div>
                      {(log.sender === 'Compiler' || log.sender === 'Sandbox') && (
                        <pre className={msgStyle}>{log.message}</pre>
                      )}
                    </div>
                  );
                })}

                {/* Empty Logs State */}
                {logs.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 select-none">
                    <TerminalIcon className="w-6 h-6 opacity-30" />
                    <span>Console ready. Submit code to stream evaluations.</span>
                  </div>
                )}
                
                {/* Autoscrolling target */}
                <div ref={logsEndRef} />
              </div>
            </div>

          </div>

        </section>
        
      </main>

    </div>
  );
}
