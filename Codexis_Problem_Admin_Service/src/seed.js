import { prisma } from './config/db.js';

async function main() {
  console.log('[Seed] Starting database seeding...');

  // 1. Clear existing data to avoid primary key/unique constraint conflicts
  console.log('[Seed] Clearing existing database tables...');
  await prisma.testcase.deleteMany();
  await prisma.codeSubs.deleteMany();
  await prisma.solution.deleteMany();
  await prisma.problem.deleteMany();

  // 2. Seed Problem 1: Two Sum
  console.log('[Seed] Creating problem "Two Sum"...');
  const twoSum = await prisma.problem.create({
    data: {
      title: 'Two Sum',
      description: `### Two Sum

Given an array of integers \`nums\` and an integer \`target\`, return *indices of the two numbers such that they add up to \`target\`*.

You may assume that each input would have ***exactly* one solution**, and you may not use the *same* element twice.

You can return the answer in any order.

#### Input Format
- Line 1: A JSON array of integers, e.g., \`[2,7,11,15]\`
- Line 2: The target integer, e.g., \`9\`

#### Output Format
- Line 1: A JSON array containing the two indices, e.g., \`[0,1]\`
`,
      difficulty: 'Easy',
      tags: 'arrays,hashmap',
      companies: 'Google,Amazon,Facebook',
      timeLimit: 2000,
      memoryLimit: 256,
      testcases: {
        create: [
          { input: "[2,7,11,15]\n9", expectedOutput: "[0,1]", isSample: true },
          { input: "[3,2,4]\n6", expectedOutput: "[1,2]", isSample: true },
          { input: "[3,3]\n6", expectedOutput: "[0,1]", isSample: false },
          { input: "[1,5,8,10,12]\n22", expectedOutput: "[3,4]", isSample: false },
        ],
      },
      codeSnippets: {
        create: [
          {
            language: 'python',
            codeTemplate: `import sys
import json

def solve():
    # Read from standard input
    lines = sys.stdin.read().splitlines()
    if not lines:
        return
    nums = json.loads(lines[0])
    target = int(lines[1])
    
    # Write your solution here
    # Example:
    # seen = {}
    # for i, num in enumerate(nums):
    #     diff = target - num
    #     if diff in seen:
    #         print(json.dumps([seen[diff], i]))
    #         return
    #     seen[num] = i

if __name__ == '__main__':
    solve()
`,
          },
          {
            language: 'javascript',
            codeTemplate: `import fs from 'fs';

function solve() {
    const input = fs.readFileSync('/dev/stdin', 'utf-8').trim().split('\\n');
    if (input.length < 2) return;
    
    const nums = JSON.parse(input[0]);
    const target = parseInt(input[1], 10);
    
    // Write your solution here
    
}

solve();
`,
          },
          {
            language: 'cpp',
            codeTemplate: `#include <iostream>
#include <vector>
#include <unordered_map>
#include <sstream>

using namespace std;

// Helper function to parse JSON-like array "[2,7,11,15]"
vector<int> parseArray(string s) {
    vector<int> res;
    stringstream ss(s);
    char ch;
    int num;
    ss >> ch; // Skip '['
    while (ss >> num) {
        res.push_back(num);
        ss >> ch; // Skip ',' or ']'
    }
    return res;
}

int main() {
    string s;
    if (!(cin >> s)) return 0;
    int target;
    if (!(cin >> target)) return 0;

    vector<int> nums = parseArray(s);
    
    // Write your solution here
    
    return 0;
}
`,
          },
        ],
      },
      solutions: {
        create: [
          {
            language: 'python',
            solutionCode: `import sys
import json

def solve():
    lines = sys.stdin.read().splitlines()
    if not lines:
        return
    nums = json.loads(lines[0])
    target = int(lines[1])
    
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            print(json.dumps([seen[diff], i]))
            return
        seen[num] = i

if __name__ == '__main__':
    solve()
`,
          },
        ],
      },
    },
  });

  // 3. Seed Problem 2: Reverse String
  console.log('[Seed] Creating problem "Reverse String"...');
  const reverseString = await prisma.problem.create({
    data: {
      title: 'Reverse String',
      description: `### Reverse String

Write a function that reverses a string. The input string is given as a single line.

#### Input Format
- Line 1: A string to reverse.

#### Output Format
- Line 1: The reversed string.
`,
      difficulty: 'Easy',
      tags: 'strings',
      companies: 'Microsoft,Apple',
      timeLimit: 1000,
      memoryLimit: 128,
      testcases: {
        create: [
          { input: "hello", expectedOutput: "olleh", isSample: true },
          { input: "CodeWar", expectedOutput: "raWedoC", isSample: true },
          { input: "a", expectedOutput: "a", isSample: false },
          { input: "Competitive Programming", expectedOutput: "gnimmargorP evititepmoC", isSample: false },
        ],
      },
      codeSnippets: {
        create: [
          {
            language: 'python',
            codeTemplate: `import sys

def solve():
    line = sys.stdin.read().strip()
    # Write solution here
    pass

if __name__ == '__main__':
    solve()
`,
          },
          {
            language: 'javascript',
            codeTemplate: `import fs from 'fs';

function solve() {
    const input = fs.readFileSync('/dev/stdin', 'utf-8').trim();
    // Write solution here
}

solve();
`,
          },
          {
            language: 'cpp',
            codeTemplate: `#include <iostream>
#include <string>
#include <algorithm>

using namespace std;

int main() {
    string s;
    if (getline(cin, s)) {
        // Write solution here
    }
    return 0;
}
`,
          },
        ],
      },
      solutions: {
        create: [
          {
            language: 'python',
            solutionCode: `import sys

def solve():
    line = sys.stdin.read().strip()
    print(line[::-1])

if __name__ == '__main__':
    solve()
`,
          },
        ],
      },
    },
  });

  // 4. Seed Problem 3: Fibonacci Number
  console.log('[Seed] Creating problem "Fibonacci Number"...');
  const fibonacci = await prisma.problem.create({
    data: {
      title: 'Fibonacci Number',
      description: `### Fibonacci Number

The **Fibonacci numbers**, commonly denoted \`F(n)\` form a sequence, called the **Fibonacci sequence**, such that each number is the sum of the two preceding ones, starting from \`0\` and \`1\`. That is:
- \`F(0) = 0, F(1) = 1\`
- \`F(n) = F(n - 1) + F(n - 2)\`, for \`n > 1\`.

Given \`n\`, calculate \`F(n)\`.

#### Input Format
- Line 1: The integer \`n\` (0 <= n <= 30)

#### Output Format
- Line 1: The Fibonacci number \`F(n)\`
`,
      difficulty: 'Easy',
      tags: 'math,dynamic programming',
      companies: 'Google,Microsoft',
      timeLimit: 1000,
      memoryLimit: 128,
      testcases: {
        create: [
          { input: "2", expectedOutput: "1", isSample: true },
          { input: "3", expectedOutput: "2", isSample: true },
          { input: "4", expectedOutput: "3", isSample: true },
          { input: "9", expectedOutput: "34", isSample: false },
          { input: "30", expectedOutput: "832040", isSample: false },
        ],
      },
      codeSnippets: {
        create: [
          {
            language: 'python',
            codeTemplate: `import sys

def solve():
    line = sys.stdin.read().strip()
    if not line:
        return
    n = int(line)
    # Write solution here

if __name__ == '__main__':
    solve()
`,
          },
          {
            language: 'javascript',
            codeTemplate: `import fs from 'fs';

function solve() {
    const input = fs.readFileSync('/dev/stdin', 'utf-8').trim();
    if (!input) return;
    const n = parseInt(input, 10);
    // Write solution here
}

solve();
`,
          },
          {
            language: 'cpp',
            codeTemplate: `#include <iostream>

using namespace std;

int main() {
    int n;
    if (cin >> n) {
        // Write solution here
    }
    return 0;
}
`,
          },
        ],
      },
      solutions: {
        create: [
          {
            language: 'python',
            solutionCode: `import sys

def solve():
    line = sys.stdin.read().strip()
    if not line:
        return
    n = int(line)
    if n == 0:
        print(0)
        return
    if n == 1:
        print(1)
        return
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    print(b)

if __name__ == '__main__':
    solve()
`,
          },
        ],
      },
    },
  });

  console.log('[Seed] Seeding completed successfully!');
  console.log(`- Created problem "Two Sum" with ID: ${twoSum.id}`);
  console.log(`- Created problem "Reverse String" with ID: ${reverseString.id}`);
  console.log(`- Created problem "Fibonacci Number" with ID: ${fibonacci.id}`);
}

main()
  .catch((e) => {
    console.error('[Seed] Error running seed script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
