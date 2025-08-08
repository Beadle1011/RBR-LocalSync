const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const os = require('os');
const chokidar = require('chokidar');
const WebSocket = require('ws');
const fs = require('fs');
const fsPromises = fs.promises;
const ini = require('ini');
const bonjour = require('bonjour')();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

let mainWindow;
const clients = {}; // Store WebSocket clients by device ID
const clientFiles = {}; // Track received files per client
const sentFiles = new Set(); // Track globally sent files
let folderPath = null;
let configFilePath; // Set this after app is ready
let db; // Initialize db variable here

// **Added variable to keep track of the WebSocket client requesting drag-and-drop**
let wsClient; // WebSocket client requesting drag-and-drop

// Helper function to get the local network IP address
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (details.family === 'IPv4' && !details.internal) {
        return details.address;
      }
    }
  }
  return 'localhost';
}

// Create WebSocket server using the local network IP
const localIP = getLocalIPAddress();
const wss = new WebSocket.Server({ port: 8080 });
const wsUrl = `ws://${localIP}:8080`; // Define WebSocket URL using the local IP

// Advertise service on local network using bonjour
bonjour.publish({ name: 'Local Sync WebSocket', type: 'ws', port: 8080 });

// Load configuration file
async function loadConfig() {
  try {
    try {
      await fsPromises.access(configFilePath);
    } catch {
      const defaultConfig = { folderPath: null };
      await fsPromises.writeFile(
        configFilePath,
        JSON.stringify(defaultConfig, null, 2)
      );
      console.log('Config file created with default settings.');
    }

    const configContent = await fsPromises.readFile(configFilePath, 'utf-8');
    const config = JSON.parse(configContent);
    folderPath = config.folderPath || null;
    if (folderPath) {
      setupDatabase(folderPath); // Initialize database if folderPath is set
    }
  } catch (error) {
    console.error('Error loading or creating config file:', configFilePath, error);
  }
}

// Create and update HTML status content in the window
function updateStatus() {
  const connectedDevices = Object.keys(clients).map(
    (deviceId) => `<li>${deviceId}</li>`
  ).join('');

  mainWindow.webContents.send('status-update', {
    folderPath,
    connectedDevices,
    fileStatus: Array.from(sentFiles),
    wsUrl // Add WebSocket URL to the status update
  });
}

function setupDatabase(basePath) {
  const dbPath = path.join(basePath, 'Plugins', 'NGPCarMenu', 'RaceStat', 'raceStatDB.sqlite3');
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      return console.error('Error opening database at path:', dbPath, 'Error:', err.message);
    }
    console.log('Connected to database at', dbPath);
  });
}

async function saveConfig() {
  const config = { folderPath };
  try {
    await fsPromises.writeFile(
      configFilePath,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error('Error saving config file:', configFilePath, error);
  }
}

app.on('ready', async () => {
  configFilePath = path.join(app.getPath('userData'), 'config.json');
  await loadConfig();

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  const htmlContent = `
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #111;
          color: #fff;
          text-align: center;
          margin: 0;
          padding: 0;
        }
        h1 {
          color: #e60000; /* Bold red like the Richard Burns text */
          margin-top: 20px;
          font-size: 28px;
          letter-spacing: 1px;
        }
        h2 {
          color: #e60000;
          margin-top: 30px;
          font-size: 22px;
        }
        #status-container {
          display: flex;
          justify-content: center;
          margin-top: 20px;
          gap: 20px;
        }
        .status-item {
          padding: 15px;
          border-radius: 8px;
          background-color: #222;
          width: 200px;
          text-align: left; /* Align text to the left */
        }
        .status-item strong {
          display: block;
          font-size: 16px;
          color: #fff; /* Changed to white */
        }
        #ws-url, #folder-path {
          display: block;
          margin: 10px 0;
          font-size: 16px;
          color: white; /* Changed to white */
        }
        #folder-path {
          text-align: left; /* Align folder path text to the left */
        }
        button {
          background-color: #e60000;
          border: none;
          color: white;
          padding: 10px 20px;
          text-align: center;
          text-decoration: none;
          display: inline-block;
          font-size: 16px;
          margin: 15px 0;
          cursor: pointer;
          border-radius: 5px;
          transition: background-color 0.3s;
        }
        button:hover {
          background-color: #cc0000;
        }
        #device-list, #file-list {
          list-style: none;
          padding: 0;
          font-size: 15px;
          text-align: left; /* Align list items to the left */
        }
        #device-list li, #file-list li {
          background-color: #333;
          margin: 5px 0;
          padding: 8px;
          border-radius: 4px;
          color: #e60000; /* Bold red text for list items */
        }
        /* Styles for drag-drop-area */
        #drag-drop-area {
          width: 100%;
          height: 100%;
          border: 2px dashed #e60000;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        #drag-drop-area p {
          font-size: 24px;
          color: #fff;
        }
        #drag-drop-area.dragover {
          background-color: rgba(230, 0, 0, 0.5);
        }
      </style>
    </head>
    <body>
      <!-- Main content -->
      <div id="main-content">
        <h1>Pacenote Sync Widget</h1>
        <div id="status-container">
          <div class="status-item">
            <strong>WebSocket URL:</strong>
            <span id="ws-url">Not available</span>
          </div>
          <div class="status-item">
            <strong>Folder Path:</strong>
            <span id="folder-path">Not set</span>
            <button onclick="window.requestFolder()">Set Folder Path</button>
          </div>
        </div>
        <h2>Connected Devices</h2>
        <ul id="device-list">
          <li>None</li>
        </ul>
        <h2>Files Found In RBR Folder</h2>
        <ul id="file-list">
          <li>None</li>
        </ul>
      </div>

      <!-- Added drag-and-drop content -->
      <div id="drag-drop-content" style="display: none;">
        <div id="drag-drop-area">
          <p>Drop .SYM files here</p>
        </div>
        <button id="back-button">Back</button>
      </div>

      <script>
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('status-update', (event, data) => {
          document.getElementById('ws-url').innerText = data.wsUrl || 'Not available';
          document.getElementById('folder-path').innerText = 'Folder Path: ' + (data.folderPath || 'Not set');
          document.getElementById('device-list').innerHTML = data.connectedDevices.length
            ? data.connectedDevices.map(device => '<li>' + device + '</li>').join('')
            : '<li>None</li>';
          document.getElementById('file-list').innerHTML = data.fileStatus.length
            ? data.fileStatus.map(file => '<li>' + file + '</li>').join('')
            : '<li>None</li>';
        });
  
        window.requestFolder = () => {
          ipcRenderer.send('request-folder');
        };

        // **Added IPC communication for mode switching**
        ipcRenderer.on('switch-mode', (event, mode) => {
          if (mode === 'drag-drop') {
            document.getElementById('main-content').style.display = 'none';
            document.getElementById('drag-drop-content').style.display = 'block';
          } else if (mode === 'normal') {
            document.getElementById('main-content').style.display = 'block';
            document.getElementById('drag-drop-content').style.display = 'none';
          }
        });

        // **Added drag-and-drop functionality**
        const dragDropArea = document.getElementById('drag-drop-area');

        dragDropArea.addEventListener('dragover', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDropArea.classList.add('dragover');
        });

        dragDropArea.addEventListener('dragleave', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDropArea.classList.remove('dragover');
        });

        dragDropArea.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDropArea.classList.remove('dragover');

          const files = event.dataTransfer.files;
          if (files.length > 0) {
            const filePath = files[0].path;
            ipcRenderer.send('file-dropped', filePath);
          }
        });

        // **Added back button functionality**
        document.getElementById('back-button').addEventListener('click', () => {
          ipcRenderer.send('switch-to-normal');
        });
      </script>
    </body>
  </html>
  `;
  
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  

  ipcMain.on('request-folder', async () => {
    const result = dialog.showOpenDialogSync(mainWindow, {
      properties: ['openDirectory']
    });

    if (result) {
      folderPath = result[0];
      await saveConfig();
      setupDatabase(folderPath); // Initialize database with the selected folder path
      startWatchingFolder(folderPath);
      updateStatus();
    }
  });

  // **Added listener for 'file-dropped' event**
  ipcMain.on('file-dropped', (event, filePath) => {
    fs.readFile(filePath, 'utf-8', (err, data) => {
      if (err) {
        console.error('Error reading file:', filePath, err);
        return;
      }

      if (wsClient) {
        wsClient.send(JSON.stringify({ type: 'file-content', content: data }));
      }

      // Send IPC message to switch back to normal mode
      mainWindow.webContents.send('switch-mode', 'normal');
    });
  });

  // **Added listener for 'switch-to-normal' event**
  ipcMain.on('switch-to-normal', () => {
    mainWindow.webContents.send('switch-mode', 'normal');
  });

  if (folderPath) {
    startWatchingFolder(folderPath);
  } else {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('status-update', { folderPath: 'Not set', wsUrl });
    });
  }
});

/**
 * Start watching the MyPacenotes directory for file changes and broadcast updates
 * to all connected clients.
 *
 * Side effects:
 * - Creates a persistent chokidar watcher.
 * - Triggers {@link broadcastFileToClients} and {@link updateStatus} when files change.
 *
 * @param {string} rootPath - Absolute path to the RBR installation directory.
 * @returns {void}
 * @throws {Error} Chokidar emits an error if the MyPacenotes directory is missing or unreadable.
 */
function startWatchingFolder(rootPath) {
  const pacenotePath = path.join(rootPath, 'Plugins', 'NGPCarMenu', 'MyPacenotes'); // Define pacenote folder path
  const watcher = chokidar.watch(pacenotePath, { persistent: true });

  watcher.on('add', filePath => {
    console.log(`File added: ${filePath}`);
    broadcastFileToClients(filePath, rootPath).catch(err => {
      console.error('Error broadcasting added file:', filePath, err);
    }); // Pass rootPath to make file paths relative
    updateStatus();
  });
  watcher.on('change', filePath => {
    console.log(`File changed: ${filePath}`);
    broadcastFileToClients(filePath, rootPath).catch(err => {
      console.error('Error broadcasting changed file:', filePath, err);
    });
    updateStatus();
  });
  watcher.on('unlink', filePath => {
    console.log(`File removed: ${filePath}`);
    sentFiles.delete(filePath); // Remove from sent files set if deleted
    updateStatus();
  });
  watcher.on('error', error => {
    console.error('Watcher error:', error);
    watcher
      .close()
      .then(() => {
        setTimeout(() => startWatchingFolder(rootPath), 5000);
      })
      .catch(err => console.error('Error restarting watcher:', err));
  });
}

// Rest of your WebSocket and database functions remain unchanged

/**
 * Read a pacenote `.ini` file and broadcast its contents to all connected clients.
 *
 * Side effects:
 * - Reads from the file system.
 * - Sends JSON data over WebSockets.
 * - Updates global tracking structures (`clientFiles`, `sentFiles`).
 *
 * @param {string} filePath - Absolute path to the file to broadcast.
 * @param {string} rootPath - Root directory used to compute the relative path for clients.
 * @returns {void}
 * @throws {Error} If reading or parsing the `.ini` file fails.
 *
 * Error conditions:
 * - Non-`.ini` files are ignored.
 * - Files outside the MyPacenotes folder or already sent are skipped.
 */

async function broadcastFileToClients(filePath, rootPath) {

  const pacenoteRoot = path.join(rootPath, 'Plugins', 'NGPCarMenu', 'MyPacenotes'); // Root path of MyPacenotes

  if (!filePath.endsWith('.ini')) {
    console.log(`Skipping non-.ini file: ${filePath}`);
    return;
  }

  if (sentFiles.has(filePath)) {
    console.log(`File ${filePath} has already been sent. Skipping.`);
    return;
  }

  try {
    // Relative path should be from inside MyPacenotes folder
    const relativePath = path.relative(pacenoteRoot, filePath);

    // Ensure the file is inside MyPacenotes
    if (relativePath.startsWith('..')) {
      console.log(`Skipping file outside of MyPacenotes: ${filePath}`);
      return;
    }

    const fileContent = await fsPromises.readFile(filePath, 'utf-8');
    const parsedContent = ini.parse(fileContent);
    const stats = await fsPromises.stat(filePath);
    const lastModified = stats.mtime.toISOString();

    const jsonContent = {
      path: relativePath, // Only the relative path within MyPacenotes
      data: parsedContent,
      date: lastModified
    };

    Object.keys(clients).forEach(deviceId => {
      if (!clientFiles[deviceId]) clientFiles[deviceId] = new Set();
      if (!clientFiles[deviceId].has(filePath)) {
        sendToClient(deviceId, jsonContent);
        clientFiles[deviceId].add(filePath);
      }
    });

    sentFiles.add(filePath);
    updateStatus();
  } catch (error) {
    console.error('Error reading or parsing .ini file:', filePath, error);
  }
}

// WebSocket server handling connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);
      console.log('Parsed message:', data);

      // **Added handling for 'show-drag-area' command**
      if (data.command === 'show-drag-area') {
        wsClient = ws; // Save the WebSocket client that requested the drag-and-drop
        // Send IPC message to switch to drag-drop mode
        mainWindow.webContents.send('switch-mode', 'drag-drop');
      } else if (data.type === 'getStageTimes' && data.slotId !== undefined) {
        console.log('Received request for stage times for slotId:', data.slotId);
        getStageTimesAfterDate(data.stageId, data.slotId, folderPath, (stageTimes) => {
          console.log('Sending stage times:', stageTimes);
          ws.send(JSON.stringify({ type: 'stageTimes', data: stageTimes }));
        });
      } else if (data.deviceId) {
        const deviceId = data.deviceId;
        clients[deviceId] = ws;
        console.log(`Device ID received: ${deviceId}`);

        if (!clientFiles[deviceId]) {
          clientFiles[deviceId] = new Set();
        }
        sendAllFilesToClient(deviceId).catch(err => {
          console.error('Error sending all files to client', deviceId, err);
        });
        sendMissingFiles(deviceId).catch(err => {
          console.error('Error sending missing files to client', deviceId, err);
        });
        updateStatus();
      } else {
        console.log('Received message without deviceId:', message);
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    
    // **Clear wsClient if it matches the disconnected client**
    if (ws === wsClient) {
      wsClient = null;
    }

    for (const [deviceId, clientWs] of Object.entries(clients)) {
      if (clientWs === ws) {
        console.log(`Device ID ${deviceId} disconnected`);
        delete clients[deviceId];
        updateStatus();
        break;
      }
    }
  });
});

/**
 * Retrieve the fastest stage time for a given stage and car slot after reading the
 * corresponding `Cars.ini` entry.
 *
 * Side effects:
 * - Reads the `Cars.ini` configuration file to determine the car ID.
 * - Performs a SQLite query against `raceStatDB.sqlite3`.
 *
 * @param {number} stageId - Identifier of the stage to query.
 * @param {number} slotId - Car slot ID used to look up the RSF car ID.
 * @param {string} folderPath - Root game folder containing `Cars.ini` and the database.
 * @param {(rows: object[]|null) => void} callback - Receives query results or `null` on database error.
 * @returns {{error: string}|undefined} Error object when validation fails; otherwise undefined and results are passed to the callback.
 *
 * Error conditions:
 * - `Cars.ini` is missing.
 * - The requested car slot or `RSFCarID` is absent.
 * - Database query errors.
 */
async function getStageTimesAfterDate(stageId, slotId, folderPath, callback) {

    const carsIniPath = path.join(folderPath, 'Cars', 'Cars.ini');

    let config;
    try {
        const iniContent = await fsPromises.readFile(carsIniPath, 'utf-8');
        config = ini.parse(iniContent);
    } catch (error) {
        console.error('Error reading Cars.ini for slot', slotId, 'at', carsIniPath, error);
        callback(null);
        return;
    }

    const section = `Car0${slotId}`;

    // Check if the section exists
    if (!config[section]) {
        callback({ error: `Car slot ID ${slotId} not found in Cars.ini` });
        return;
    }

    // Check if the RSFCarID is present
    if (!config[section].RSFCarID) {
        callback({ error: `RSFCarID not found for slot ID ${slotId}` });
        return;
    }

    const carId = parseInt(config[section].RSFCarID, 10);

  console.log(`Executing query for car ${carId} on stage ${stageId}`);

  // SQL Query
  const query = `
    SELECT 
    FRR.RaceDate, 
    FRR.RaceDateTime, 
    FRR.RallyName, 
    M.MapID AS StageID, 
    M.StageName, 
    FRR.Split1Time, -- Add Split1Time to the result
    FRR.Split2Time, -- Add Split2Time to the result
    FRR.FinishTime AS FastestStageTime,
    M.Format AS StageFormat, 
    M.Length AS StageLength, 
    C.CarID, 
    C.ModelName AS CarModel, 
    C.FIACategory AS FIACat,
    (FRR.FalseStartPenaltyTime + FRR.CutPenaltyTime + FRR.OtherPenaltyTime) AS TotalPenaltyTime
FROM 
    F_RallyResult FRR
JOIN 
    D_Map M ON FRR.MapKey = M.MapKey
JOIN 
    D_Car C ON FRR.CarKey = C.CarKey
WHERE 
    FRR.FinishTime IS NOT NULL 
    AND M.MapID = ? 
    AND C.CarID = ?  
ORDER BY 
    FRR.FinishTime ASC
LIMIT 1;

  `;

  // Execute the query
  db.all(query, [stageId, carId], (err, rows) => {
      if (err) {
          console.error('Database error for stage', stageId, 'car', carId, err);
          callback(null); // Pass null to the callback in case of error
          return;
      }

      console.log('Query results:', rows);
      callback(rows); // Pass the query results to the callback
  });
}


// Function to send all available .ini files to a specific client
async function sendAllFilesToClient(deviceId) {
  const client = clients[deviceId];
  if (!client) return;

  // Clear the client's sent files set to resend all files
  clientFiles[deviceId] = new Set();

  const pacenotePath = path.join(folderPath, 'Plugins', 'NGPCarMenu', 'MyPacenotes');
  let files;
  try {
    files = await fsPromises.readdir(pacenotePath);
  } catch (error) {
    console.error('Error reading directory:', pacenotePath, error);
    return;
  }

  for (const file of files) {
    const filePath = path.join(pacenotePath, file);
    if (file.endsWith('.ini')) {
      try {
        const fileContent = await fsPromises.readFile(filePath, 'utf-8');
        const parsedContent = ini.parse(fileContent);
        const stats = await fsPromises.stat(filePath);
        const lastModified = stats.mtime.toISOString();
        const relativePath = path.relative(pacenotePath, filePath);

        const jsonContent = {
          path: relativePath,
          data: parsedContent,
          date: lastModified
        };
        sendToClient(deviceId, jsonContent); // Send each .ini file to the client
      } catch (error) {
        console.error('Error processing file:', filePath, error);
      }
    }
  }

  console.log(`Resent all available files to device ${deviceId}`);
}

function sendToClient(deviceId, jsonContent) {
  const client = clients[deviceId];
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(jsonContent));
    console.log(`Sending file with modified date: ${jsonContent.date}`);
    //console.log(`Sent file to device ${deviceId}:`, jsonContent);
  }
}

async function sendMissingFiles(deviceId) {
  if (!clients[deviceId]) return;
  if (!clientFiles[deviceId]) clientFiles[deviceId] = new Set();

  for (const filePath of sentFiles) {
    const relativePath = path.relative(folderPath, filePath);
    try {
      const stats = await fsPromises.stat(filePath);
      const lastModified = stats.mtime.toISOString();

      if (!clientFiles[deviceId].has(filePath)) {
        const dataContent = await fsPromises.readFile(filePath, 'utf-8');
        sendToClient(deviceId, {
          path: relativePath,
          data: ini.parse(dataContent),
          date: lastModified
        });
        clientFiles[deviceId].add(filePath);
      }
    } catch (error) {
      console.error('Error sending missing file:', filePath, error);
    }
  }
}

app.on('before-quit', () => {
  bonjour.unpublishAll(() => {
    bonjour.destroy();
  });
});
