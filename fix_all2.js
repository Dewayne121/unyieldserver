const fs = require('fs');
let content = fs.readFileSync('routes/admin.js', 'utf8');

content = content.replace(/\r\n/g, '\n');

// Fix pattern: "    };\n  }));" -> "    });\n  }));"
content = content.replace(/    };\n  \}\)\);/g, '    });\n  }));');

// Fix other variants
content = content.replace(/  };\n  \}\)\);/g, '  });\n  }));');
content = content.replace(/    };\n\}\)\);/g, '    });\n}));');
content = content.replace(/  };\n\}\)\);/g, '  });\n}));');

fs.writeFileSync('routes/admin.js', content);
console.log('Fixed all variants');
