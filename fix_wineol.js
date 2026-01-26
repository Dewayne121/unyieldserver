const fs = require('fs');
let content = fs.readFileSync('routes/admin.js', 'utf8');

// First normalize line endings to \n
content = content.replace(/\r\n/g, '\n');

// Replace all instances of "    };\n}))" with "    });\n}))"
content = content.replace(/    };\n\}\)\);/g, '    });\n}));');

// Also fix the 2-space variant
content = content.replace(/  };\n\}\)\);/g, '  });\n}));');

fs.writeFileSync('routes/admin.js', content);
console.log('Fixed all patterns and normalized line endings');
