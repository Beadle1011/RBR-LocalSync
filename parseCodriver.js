const fs = require("fs");
const path = require("path");
const ini = require("ini");

let visitedFiles = new Set(); // To prevent re-processing of the same file

// Parse a single PACENOTE file and extract `[PACENOTE::...]` sections
function parsePacenoteFile(filePath, pacenoteType) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const iniContent = fs.readFileSync(filePath, "utf-8");
    const config = ini.parse(iniContent);

    const pacenotes = [];
    const keyOrder = ["id", "sounds", "snd0", "snd1", "column", "link"];
    const fileName = path.basename(filePath); // Get the .ini file name

    for (const section in config) {
        if (section.startsWith("PACENOTE::")) {
            const name = section.replace("PACENOTE::", "");
            const values = keyOrder.reduce((acc, key) => {
                acc[key] = config[section]?.[key] || null;
                return acc;
            }, {});
            values["name"] = name;
            values["type"] = pacenoteType; // Add the pacenote type
            values["source"] = fileName; // Include the source .ini file name
            pacenotes.push(values);
        }
    }

    return pacenotes;
}

// Determine the type from the folder name of the referenced file
function determineTypeFromPath(filePath, baseDir) {
    const relativePath = path.relative(baseDir, filePath); // Get the path relative to the base directory
    const folders = relativePath.split(path.sep); // Split into folder segments
    return folders.length > 1 ? folders[0] : "UNKNOWN"; // Use the first folder down from the base
}

// Recursively process all `.ini` files referenced in `[PACKAGE::...]` or `[CATEGORY::...]` sections
function processIniFile(filePath, baseDir, pacenoteType = "UNKNOWN") {
    const resolvedFilePath = path.resolve(baseDir, filePath);

    if (visitedFiles.has(resolvedFilePath)) {
        return []; // Skip already processed files
    }

    console.log(`Processing INI file: ${resolvedFilePath}`);
    visitedFiles.add(resolvedFilePath);

    if (!fs.existsSync(resolvedFilePath)) {
        throw new Error(`File not found: ${resolvedFilePath}`);
    }

    const iniContent = fs.readFileSync(resolvedFilePath, "utf-8");
    const config = ini.parse(iniContent);

    const pacenotes = [];

    // Determine type from folder name if not explicitly provided
    if (pacenoteType === "UNKNOWN") {
        pacenoteType = determineTypeFromPath(resolvedFilePath, baseDir);
        console.log(`Derived pacenote type from folder: ${pacenoteType}`);
    }

    // Process `[PACKAGE::...]` sections for references
    for (const section in config) {
        if (section.startsWith("PACKAGE::")) {
            const packageType = section.replace("PACKAGE::", "");
            const packageSection = config[section];

            for (const key in packageSection) {
                if (key.startsWith("file")) {
                    const relativePath = packageSection[key]?.replace("\\", "/");
                    if (relativePath) {
                        const fullPath = path.resolve(baseDir, relativePath);
                        console.log(`Parsing referenced file from PACKAGE: ${fullPath}`);
                        pacenotes.push(...processIniFile(fullPath, baseDir, packageType));
                    }
                }
            }
        }
    }

    // Process `[CATEGORY::...]` sections for references
    for (const section in config) {
        if (section.startsWith("CATEGORY::")) {
            const categorySection = config[section];
            const relativePath = categorySection?.file?.replace("\\", "/");
            if (relativePath) {
                const fullPath = path.resolve(baseDir, relativePath);
                console.log(`Parsing referenced file from CATEGORY: ${fullPath}`);
                pacenotes.push(...processIniFile(fullPath, baseDir, pacenoteType));
            }
        }
    }

    // Parse PACENOTE sections in the current file
    pacenotes.push(...parsePacenoteFile(resolvedFilePath, pacenoteType));

    return pacenotes;
}

// Process all `.ini` files in the base directory
function processAllIniFiles(directoryPath) {
    console.log(`Processing all INI files in directory: ${directoryPath}`);
    if (!fs.existsSync(directoryPath)) {
        throw new Error(`Directory not found: ${directoryPath}`);
    }

    const iniFiles = fs.readdirSync(directoryPath).filter((file) => file.endsWith(".ini"));
    const aggregatedPacenotes = [];

    iniFiles.forEach((file) => {
        const fullPath = path.join(directoryPath, file);
        try {
            const pacenotes = processIniFile(fullPath, directoryPath);
            aggregatedPacenotes.push(...pacenotes);
        } catch (error) {
            console.error(`Error processing ${file}: ${error.message}`);
        }
    });

    return aggregatedPacenotes;
}

// Export aggregated pacenotes to a JSON file
function exportJsonResults(pacenotes, outputFilePath) {
    fs.writeFileSync(outputFilePath, JSON.stringify(pacenotes, null, 2), "utf-8");
    console.log(`Pacenotes exported to JSON: ${outputFilePath}`);
}
// Allow running from the command line with user-provided paths
if (require.main === module) {
    const [baseDir, outputFilePath] = process.argv.slice(2);

    if (!baseDir || !outputFilePath) {
        console.error("Usage: node parseCodriver.js <baseDir> <outputFilePath>");
        process.exit(1);
    }

    try {
        console.log(`Starting processing for directory: ${baseDir}`);
        const pacenotes = processAllIniFiles(baseDir);

        console.log("Aggregated PACENOTES Data:");
        console.log(JSON.stringify(pacenotes, null, 2));

        exportJsonResults(pacenotes, outputFilePath);

        console.log("Processing complete.");
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

module.exports = {
    parsePacenoteFile,
    determineTypeFromPath,
    processIniFile,
    processAllIniFiles,
    exportJsonResults,
};
