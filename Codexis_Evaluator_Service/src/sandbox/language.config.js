// Language configurations mapped to the actual images cached in your Docker Desktop
export const LANG_CONFIGS = {
  python: {
    fileName: 'solution.py',
    image: 'python:3.9-alpine',
    compileCmd: null, // Python is an interpreted language. No compilation step is needed...
    runCmd: ['python', 'solution.py'],
  },
  cpp: {
    fileName: 'solution.cpp',
    image: 'gcc:latest',
    compileCmd: ['g++', '-O3', 'solution.cpp', '-o', 'solution'], // Produces native executable Code..
    // Source code is compiled directly into machine code and executed by the OS.
    // solution.cpp   ← Your source code
    //solution       ← New executable file
    runCmd: ['./solution'],
  },
  java: {
    fileName: 'Solution.java',
    image: 'eclipse-temurin:11-jdk', // Matches the exact Java image downloaded on your computer
    compileCmd: ['javac', 'Solution.java'], // Produces bytecode, not machine code. JVM is required.
    // Source code is compiled into bytecode (.class), which is executed by the JVM.
    // Solution.java  ← Your source code
    // Solution.class ← New bytecode file
    runCmd: ['java', 'Solution'],
  },
  javascript: {
    fileName: 'solution.js',
    image: 'node:18-alpine',
    compileCmd: null, // JavaScript is interpreted, no compilation step needed.
    runCmd: ['node', 'solution.js'],
  },
};
