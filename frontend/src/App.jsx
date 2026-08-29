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
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/clerk-react';

const GATEWAY_URL = 'http://localhost:8000';

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
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsSubTab, setStatsSubTab] = useState('breakdown');
  const [leftView, setLeftView] = useState('problems');
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const [problemsPage, setProblemsPage] = useState(1);
  const [hasMoreProblems, setHasMoreProblems] = useState(true);
  const [loadingProblems, setLoadingProblems] = useState(false);

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
    
    // Admin Service (Problems)
    try {
      const res = await fetch(`${GATEWAY_URL}/health/problems`);
      setServicesHealth(prev => ({ ...prev, admin: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, admin: 'offline' }));
    }

    // Submission Service
    try {
      const res = await fetch(`${GATEWAY_URL}/health/submissions`);
      setServicesHealth(prev => ({ ...prev, submission: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, submission: 'offline' }));
    }

    // Socket Service
    try {
      const res = await fetch(`${GATEWAY_URL}/health/socket`);
      setServicesHealth(prev => ({ ...prev, socket: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, socket: 'offline' }));
    }

    // User Service
    try {
      const res = await fetch(`${GATEWAY_URL}/health/users`);
      setServicesHealth(prev => ({ ...prev, user: res.ok ? 'online' : 'offline' }));
    } catch {
      setServicesHealth(prev => ({ ...prev, user: 'offline' }));
    }
  };

  // 2. Fetch problems and leaderboard on mount
  useEffect(() => {
    checkHealth();
    fetchProblems();
    fetchLeaderboard();
  }, []);

  // Fetch leaderboard when leftView changes to 'leaderboard'
  useEffect(() => {
    if (leftView === 'leaderboard') {
      fetchLeaderboard();
    }
  }, [leftView]);

  const fetchProblems = async (page = 1, append = false) => {
    if (loadingProblems) return;
    setLoadingProblems(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/problems/all?page=${page}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        const probs = data.problems || [];

        if (append) {
          setProblems((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const newProbs = probs.filter((p) => !existingIds.has(p.id));
            return [...prev, ...newProbs];
          });
        } else {
          setProblems(probs);
          if (probs.length > 0 && !selectedProblemId) {
            setSelectedProblemId(probs[0].id);
          }
        }

        if (data.pagination) {
          setHasMoreProblems(page < data.pagination.totalPages);
        } else {
          setHasMoreProblems(false);
        }
      }
    } catch (err) {
      console.error('Failed to fetch problems:', err);
      addLog('System', 'Failed to fetch problems list. Make sure the API Gateway is running on port 8000.', 'error');
    } finally {
      setLoadingProblems(false);
    }
  };

  const handleSidebarScroll = (e) => {
    if (leftView !== 'problems' || !hasMoreProblems || loadingProblems) return;

    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 30) {
      const nextPage = problemsPage + 1;
      setProblemsPage(nextPage);
      fetchProblems(nextPage, true);
    }
  };

  const fetchLeaderboard = async () => {
    setLoadingLeaderboard(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/leaderboard/global`);
      if (res.ok) {
        const data = await res.json();
        setProblems(prev => prev); // dummy trigger
        setLeaderboard(data);
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  // Fetch submissions history for the signed-in user
  const fetchSubmissionsHistory = async () => {
    if (!userId) return;
    setLoadingSubmissions(true);
    try {
      const token = await getToken();
      const res = await fetch(`${GATEWAY_URL}/api/submissions/history`, {
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

  // Load submissions history when user log state changes or on mount
  useEffect(() => {
    if (userId) {
      fetchSubmissionsHistory();
    }
  }, [userId]);

  // Fetch submission stats for the selected problem
  const fetchProblemStats = async () => {
    if (!selectedProblemId || !userId) return;
    setLoadingStats(true);
    try {
      const token = await getToken();
      const res = await fetch(`${GATEWAY_URL}/api/submissions/problem/${selectedProblemId}/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('[Frontend] Failed to fetch problem stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // Load stats when stats tab is clicked or user selection changes
  useEffect(() => {
    if (userId && activeTab === 'stats') {
      fetchProblemStats();
    }
  }, [userId, activeTab, selectedProblemId]);

  // 3. Fetch problem details when selected problem changes
  useEffect(() => {
    if (!selectedProblemId) return;

    const fetchProblemDetail = async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/problems/get/${selectedProblemId}`);
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

      // POST to Submission Service via Gateway (Port 8000)
      const res = await fetch(`${GATEWAY_URL}/api/submissions`, {
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

      if (res.status === 429) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Rate limit exceeded. Please wait.');
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to submit code');
      }

      const submission = await res.json();
      const submissionId = submission.id;
      addLog('System', `Submission created! ID: ${submissionId.substring(0, 8)}...`, 'success');

      if (submission.status && submission.status !== 'PENDING') {
        // Cache Hit! Render result directly without setting up WebSockets
        setFinalStatus(submission.status);
        if (submission.status === 'ACCEPTED') {
          addLog('Evaluator', 'SUCCESS: All test cases passed! (Cached Result) ✅', 'success');
          if (submission.executionTime !== null && submission.executionTime !== undefined) {
            addLog('Evaluator', `Max Execution Time: ${submission.executionTime} ms`, 'success');
          }
          if (submission.executionMemory !== null && submission.executionMemory !== undefined) {
            addLog('Evaluator', `Mock Memory Usage: ${(submission.executionMemory / 1024).toFixed(2)} MB`, 'success');
          }
        } else if (submission.status === 'WRONG_ANSWER') {
          addLog('Evaluator', 'FAILED: Incorrect outputs detected. Status: WRONG_ANSWER (Cached) ❌', 'error');
        } else if (submission.status === 'COMPILATION_ERROR') {
          addLog('Evaluator', 'FAILED: Code compilation failed. Status: COMPILATION_ERROR (Cached) ❌', 'error');
        } else if (submission.status === 'TIME_LIMIT_EXCEEDED') {
          addLog('Evaluator', 'FAILED: Solution exceeded the time limit. Status: TIME_LIMIT_EXCEEDED (Cached) ⏳', 'error');
        } else {
          addLog('Evaluator', `FAILED: Status: ${submission.status} (Cached) ❌`, 'error');
        }
        
        // Refresh history and stats
        fetchSubmissionsHistory();
        fetchLeaderboard();
        fetchProblemStats();
        setIsSubmitting(false);
        return;
      }

      addLog('System', 'Connecting to real-time events socket via API Gateway...', 'info');

      // Initialize Socket connection
      setupSocketConnection(submissionId);

    } catch (err) {
      console.error(err);
      addLog('System', `Submission failed: ${err.message}`, 'error');
      setIsSubmitting(false);
    }
  };

  const setupSocketConnection = async (submissionId) => {
    let token = null;
    try {
      token = await getToken();
    } catch (err) {
      console.error('[Socket] Failed to retrieve auth token:', err);
    }

    // Connect to Socket Service via Gateway (Port 8000)
    // This sends a connection request over the network to the server. 
    // (Then server internal node modules (io-library) emits : connection.. )
    const socket = io(GATEWAY_URL, {
      transports: ['websocket'],
      auth: {
        token: token ? `Bearer ${token}` : '',
      }
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // The Socket.IO Client Library (running in the browser on the frontend) emits the 'connect' event.
      setSocketStatus('connected');
      addLog('Socket', 'Connected to broker. Subscribing to updates...', 'info');
      // Join room for this submission
      socket.emit('joinSubmission', submissionId);
      // The server puts that specific browser tab into a virtual room called 'submission-123'.
      // Since the user's browser tab is the only client inside the 'submission-123' room, only that user's tab receives the message.
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
          // Refresh user history and leaderboard rankings
          fetchSubmissionsHistory();
          fetchLeaderboard();
          fetchProblemStats();
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
        // Refresh submissions history list & stats
        fetchSubmissionsHistory();
        fetchProblemStats();
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
        
        {/* SIDEBAR - PROBLEMS & LEADERBOARD TOGGLE */}
        <section onScroll={handleSidebarScroll} className="w-72 bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          {/* View Toggler */}
          <div className="flex border-b border-slate-800 pb-2 shrink-0">
            <button
              onClick={() => setLeftView('problems')}
              className={`flex-1 text-center pb-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer border-b-2 ${
                leftView === 'problems'
                  ? 'text-purple-400 border-purple-500'
                  : 'text-slate-500 border-transparent hover:text-slate-350'
              }`}
            >
              Problems
            </button>
            <button
              onClick={() => setLeftView('leaderboard')}
              className={`flex-1 text-center pb-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer border-b-2 ${
                leftView === 'leaderboard'
                  ? 'text-purple-400 border-purple-500'
                  : 'text-slate-500 border-transparent hover:text-slate-350'
              }`}
            >
              Leaderboard
            </button>
          </div>

          {leftView === 'problems' ? (
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

              {loadingProblems && problems.length > 0 && (
                <div className="text-center py-2 text-xs text-purple-400 font-medium">
                  Loading more problems...
                </div>
              )}

              {problems.length === 0 && (
                <div className="text-center py-8 text-slate-600 text-sm">
                  No problems found. Seed the database first!
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  🏆 Global Standings
                </h3>
                {leaderboard.length > 0 && (
                  <div className="flex items-center gap-1 bg-slate-950/40 border border-slate-800/60 rounded-lg p-0.5 shrink-0">
                    <button
                      onClick={() => setLeaderboardPage(prev => Math.max(0, prev - 1))}
                      disabled={leaderboardPage === 0}
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent cursor-pointer transition-colors"
                      title="Previous Page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-bold text-slate-500 min-w-[28px] text-center select-none">
                      {leaderboardPage + 1}/{Math.ceil(leaderboard.length / 10)}
                    </span>
                    <button
                      onClick={() => setLeaderboardPage(prev => Math.min(Math.ceil(leaderboard.length / 10) - 1, prev + 1))}
                      disabled={leaderboardPage >= Math.ceil(leaderboard.length / 10) - 1}
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent cursor-pointer transition-colors"
                      title="Next Page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              
              {loadingLeaderboard ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Loading rankings...
                </div>
              ) : leaderboard.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {leaderboard.slice(leaderboardPage * 10, (leaderboardPage + 1) * 10).map((rankInfo) => {
                    const isCurrentUser = rankInfo.userId === userId;
                    let rankBadge = `${rankInfo.rank}`;
                    if (rankInfo.rank === 1) rankBadge = '🥇';
                    else if (rankInfo.rank === 2) rankBadge = '🥈';
                    else if (rankInfo.rank === 3) rankBadge = '🥉';

                    return (
                      <div
                        key={rankInfo.userId}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${
                          isCurrentUser
                            ? 'bg-purple-950/20 border-purple-500/40 text-white'
                            : 'bg-slate-950/30 border-slate-800/80 text-slate-300'
                        }`}
                      >
                        <span className="text-sm font-bold w-6 text-center shrink-0">
                          {rankBadge}
                        </span>
                        
                        {rankInfo.imageUrl ? (
                          <img
                            src={rankInfo.imageUrl}
                            alt={rankInfo.username}
                            className="w-7 h-7 rounded-full border border-slate-700 object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-450 shrink-0">
                            {rankInfo.username.substring(0, 2).toUpperCase()}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs truncate">
                            {rankInfo.username}
                            {isCurrentUser && (
                              <span className="ml-1.5 text-[9px] font-bold text-purple-400 bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-800/60 uppercase">
                                You
                              </span>
                            )}
                          </p>
                        </div>

                        <span className="text-xs font-bold text-amber-400 shrink-0 bg-amber-950/20 border border-amber-900/40 px-2 py-0.5 rounded-md">
                          {rankInfo.points} pts
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-600 text-xs">
                  No rankings found. Be the first to solve a problem!
                </div>
              )}
            </div>
          )}
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
                  <button 
                    className={`px-6 py-3 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all duration-200 ${
                      activeTab === 'stats' 
                        ? 'border-purple-500 text-white bg-slate-900/40' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setActiveTab('stats')}
                  >
                    Stats & Analytics
                  </button>
                </div>

                {/* Tab content area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                  {activeTab === 'description' && (
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
                  )}

                  {activeTab === 'submissions' && (
                    <div className="flex-1 flex flex-col gap-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">My Submissions History</h3>
                      
                      {!userId ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-12">
                          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-slate-550" />
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

                  {activeTab === 'stats' && (
                    <div className="flex-1 flex flex-col gap-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Problem Analytics & Statistics</h3>
                        <button
                          onClick={fetchProblemStats}
                          disabled={loadingStats}
                          className="p-1.5 rounded-lg border border-slate-800 hover:border-purple-500/50 hover:text-purple-400 text-slate-500 bg-slate-950/40 transition-colors cursor-pointer"
                          title="Refresh Stats"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      {!userId ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-12">
                          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-slate-550" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white mb-1">Authentication Required</h4>
                            <p className="text-xs text-slate-550 max-w-xs leading-relaxed">
                              Sign in to view real-time community statistics and performance distributions.
                            </p>
                          </div>
                          <SignInButton mode="modal">
                            <button className="text-xs font-bold px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white cursor-pointer shadow-md shadow-purple-950/20">
                              Sign In
                            </button>
                          </SignInButton>
                        </div>
                      ) : loadingStats ? (
                        <div className="flex-1 flex items-center justify-center py-12 text-slate-505 text-xs gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-purple-500" />
                          <span>Loading problem analytics...</span>
                        </div>
                      ) : !stats || (!stats.statusCounts || stats.statusCounts.length === 0) ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-12 text-slate-505 text-xs">
                          <Activity className="w-6 h-6 opacity-30" />
                          <span>No submission records found for this problem yet.</span>
                        </div>
                      ) : (() => {
                        const totalSubmissions = stats.statusCounts.reduce((acc, curr) => acc + curr.count, 0);
                        const acceptedCount = stats.statusCounts.find(s => s.status === 'ACCEPTED')?.count || 0;
                        const acceptanceRate = totalSubmissions > 0 ? ((acceptedCount / totalSubmissions) * 100).toFixed(1) : '0.0';

                        const bucketCounts = Array(5).fill(0);
                        stats.timeDistribution?.forEach(td => {
                          const idx = td.time_bucket - 1;
                          if (idx >= 0 && idx < 5) {
                            bucketCounts[idx] = td.count;
                          }
                        });
                        const maxBucketCount = Math.max(...bucketCounts, 1);

                        return (
                          <div className="flex flex-col gap-6 overflow-y-auto pr-1">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-3 gap-4">
                              <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex flex-col gap-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Submissions</span>
                                <span className="text-xl font-bold text-white">{totalSubmissions}</span>
                              </div>
                              <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex flex-col gap-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Accepted Runs</span>
                                <span className="text-xl font-bold text-emerald-400">{acceptedCount}</span>
                              </div>
                              <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex flex-col gap-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Acceptance Rate</span>
                                <span className="text-xl font-bold text-purple-400">{acceptanceRate}%</span>
                              </div>
                            </div>

                            {/* Sub-tab Switcher (Segment Control) */}
                            <div className="flex bg-slate-950/40 border border-slate-850 rounded-xl p-1 gap-1 shrink-0">
                              <button
                                onClick={() => setStatsSubTab('breakdown')}
                                className={`flex-1 text-center py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                                  statsSubTab === 'breakdown'
                                    ? 'bg-purple-600/90 text-white shadow-md shadow-purple-950/20'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                Status Breakdown
                              </button>
                              <button
                                onClick={() => setStatsSubTab('distribution')}
                                className={`flex-1 text-center py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                                  statsSubTab === 'distribution'
                                    ? 'bg-purple-600/90 text-white shadow-md shadow-purple-950/20'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                Performance Distribution
                              </button>
                            </div>

                            {/* Core charts container */}
                            <div className="flex flex-col gap-6 items-stretch">
                              {statsSubTab === 'breakdown' && (
                                /* Status Breakdown Panel */
                                <div className="bg-slate-950/20 border border-slate-850 rounded-xl p-4 flex flex-col gap-4">
                                  <h4 className="text-xs font-bold text-slate-350 uppercase tracking-wider border-b border-slate-850 pb-2">Submission Status Breakdown</h4>
                                  <div className="flex flex-col gap-3">
                                    {stats.statusCounts.map(item => {
                                      const percent = ((item.count / totalSubmissions) * 100).toFixed(1);
                                      let barColor = "bg-red-500";
                                      let textColor = "text-red-400 border-red-950/50 bg-red-950/20";
                                      if (item.status === 'ACCEPTED') {
                                        barColor = "bg-emerald-500";
                                        textColor = "text-emerald-400 border-emerald-950/50 bg-emerald-950/20";
                                      } else if (item.status === 'RUNNING' || item.status === 'PENDING') {
                                        barColor = "bg-purple-500";
                                        textColor = "text-purple-400 border-purple-950/50 bg-purple-950/20";
                                      } else if (item.status === 'WRONG_ANSWER') {
                                        barColor = "bg-amber-500";
                                        textColor = "text-amber-400 border-amber-950/50 bg-amber-950/20";
                                      }
                                      return (
                                        <div key={item.status} className="flex flex-col gap-1.5">
                                          <div className="flex justify-between items-center text-xs">
                                            <span className={`text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${textColor}`}>
                                              {item.status}
                                            </span>
                                            <span className="text-slate-400 font-semibold">{item.count} ({percent}%)</span>
                                          </div>
                                          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-850">
                                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${percent}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {statsSubTab === 'distribution' && (
                                /* Time distribution chart */
                                <div className="bg-slate-950/20 border border-slate-850 rounded-xl p-4 flex flex-col gap-4">
                                  <h4 className="text-xs font-bold text-slate-350 uppercase tracking-wider border-b border-slate-850 pb-2">Accepted Execution Times</h4>
                                  
                                  {stats.timeDistribution && stats.timeDistribution.length > 0 ? (
                                    <div className="flex flex-col gap-4">
                                      {/* Column layout histogram */}
                                      <div className="h-40 flex items-end gap-3 px-2 pt-4">
                                        {bucketCounts.map((count, index) => {
                                          const percentHeight = ((count / maxBucketCount) * 100);
                                          return (
                                            <div key={index} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                              {/* Hover Tooltip */}
                                              <div className="absolute bottom-full mb-2 bg-slate-900 border border-slate-800 text-[10px] text-slate-200 px-2 py-1 rounded shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-bold whitespace-nowrap z-10">
                                                {count} submissions
                                              </div>
                                              
                                              {/* Bar */}
                                              <div 
                                                className="w-full rounded-t-lg bg-gradient-to-t from-purple-600 to-indigo-500 group-hover:from-purple-500 group-hover:to-indigo-400 transition-all duration-300 relative shadow-lg shadow-purple-950/30"
                                                style={{ height: `${Math.max(percentHeight, 4)}%` }}
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {/* X-Axis labels */}
                                      <div className="flex gap-3 px-2 text-[9px] font-mono font-bold text-slate-500">
                                        {["0-400ms", "400-800ms", "800-1200ms", "1200-1600ms", "1600+ms"].map((lbl, idx) => (
                                          <span key={idx} className="flex-1 text-center truncate">{lbl}</span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="h-44 flex flex-col items-center justify-center gap-1.5 text-center text-slate-650 text-xs">
                                      <Cpu className="w-5 h-5 opacity-30 animate-pulse" />
                                      <span>No accepted execution runs to measure.</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
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
