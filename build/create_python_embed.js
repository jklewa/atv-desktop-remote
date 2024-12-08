const fs = require('fs');
const path = require('path');

// Define input and output paths
const serverDir = path.join(__dirname, '..', 'server');
const outFile = path.join(__dirname, '..', 'app', 'pyscripts.js');

// Define the files to embed
const inputFiles = [
    path.join(serverDir, 'wsserver.py'),
    path.join(serverDir, 'start_server.bat'),
    path.join(serverDir, 'start_server.sh')
];

// Create files object
const files = {};
inputFiles.forEach(filePath => {
    const fileName = path.basename(filePath);
    try {
        files[fileName] = fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch (err) {
        console.error(`Error reading ${fileName}:`, err);
        process.exit(1);
    }
});

// Generate output
const output = `/* Generated file - DO NOT MODIFY */\nconst files = ${JSON.stringify(files, null, 4)};\n\nexports.files = files;\n/* Generated file - DO NOT MODIFY */\n`;

// Write output file
try {
    fs.writeFileSync(outFile, output, { encoding: 'utf-8' });
    console.log(`Successfully generated ${outFile}`);
} catch (err) {
    console.error('Error writing output file:', err);
    process.exit(1);
}
