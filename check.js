const fs = require('fs');
const lines = fs.readFileSync('routes/admin.js', 'utf8').split('\n');

for (let i = 0; i < lines.length - 1; i++) {
  if (lines[i].trim() === '};' && lines[i+1].trim() === '}))' && lines[i].match(/^\s+};$/)) {
    console.log(`Line ${i+1}: "${lines[i]}" followed by line ${i+2}: "${lines[i+1]}"`);
    lines[i] = lines[i].replace('};', '});');
  }
}

fs.writeFileSync('routes/admin.js', lines.join('\n'));
console.log('Done');
