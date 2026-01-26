const fs = require('fs');
const lines = fs.readFileSync('routes/admin.js', 'utf8').split('\n');

for (let i = 0; i < lines.length - 1; i++) {
  // If current line is "    };" and next line is "}))"
  if (lines[i].trim() === '};' && lines[i+1].trim() === '}))' && lines[i].startsWith('    ')) {
    lines[i] = '    });';
  }
}

const fixed = lines.join('\n');
fs.writeFileSync('routes/admin.js', fixed);
console.log('Fixed all patterns');
