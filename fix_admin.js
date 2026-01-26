const fs = require('fs');
let content = fs.readFileSync('routes/admin.js', 'utf8');

// Fix 1: Remove duplicate activeUsersCount declaration
content = content.replace(
  /\/\/ Active users \(users who logged workout in last 7 days\)\s+const activeUsersCount = await prisma\.workout\.count\(\{[^}]+\}\)\.then\(count => count\);[\s\S]*?\/\/ Get distinct user IDs from workouts/s,
  `// Active users (users who logged workout in last 7 days)
  // Get distinct user IDs from workouts`
);

// Fix 2: Replace all instances of "  };\n}))" with "  });\n}))"
// This pattern appears after res.json calls
content = content.replace(/  };\n\}\)\);/g, '  });\n}));');

fs.writeFileSync('routes/admin.js', content);
console.log('Fixed admin.js');
