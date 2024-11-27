const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const os = require('os');
const chokidar = require('chokidar');
const WebSocket = require('ws');
const fs = require('fs');
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
function loadConfig() {
  try {
    if (!fs.existsSync(configFilePath)) {
      const defaultConfig = { folderPath: null };
      fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2));
      console.log('Config file created with default settings.');
    }
    
    const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
    folderPath = config.folderPath || null;
    if (folderPath) {
      setupDatabase(folderPath); // Initialize database if folderPath is set
    }
  } catch (error) {
    console.error('Error loading or creating config file:', error);
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

function saveConfig() {
  const config = { folderPath };
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
}

app.on('ready', () => {
  configFilePath = path.join(app.getPath('userData'), 'config.json');
  loadConfig();

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
      saveConfig();
      setupDatabase(folderPath); // Initialize database with the selected folder path
      startWatchingFolder(folderPath);
      updateStatus();
    }
  });

  // **Added listener for 'file-dropped' event**
  ipcMain.on('file-dropped', (event, filePath) => {
    fs.readFile(filePath, 'utf-8', (err, data) => {
      if (err) {
        console.error('Error reading file:', err);
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

function startWatchingFolder(rootPath) {
  const pacenotePath = path.join(rootPath, 'Plugins', 'NGPCarMenu', 'MyPacenotes'); // Define pacenote folder path
  const watcher = chokidar.watch(pacenotePath, { persistent: true });

  watcher.on('add', filePath => {
    console.log(`File added: ${filePath}`);
    broadcastFileToClients(filePath, rootPath); // Pass rootPath to make file paths relative
    updateStatus();
  });
  watcher.on('change', filePath => {
    console.log(`File changed: ${filePath}`);
    broadcastFileToClients(filePath, rootPath);
    updateStatus();
  });
  watcher.on('unlink', filePath => {
    console.log(`File removed: ${filePath}`);
    sentFiles.delete(filePath); // Remove from sent files set if deleted
    updateStatus();
  });
}

// Rest of your WebSocket and database functions remain unchanged

function broadcastFileToClients(filePath, rootPath) {
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

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsedContent = ini.parse(fileContent);

    const jsonContent = {
      path: relativePath, // Only the relative path within MyPacenotes
      data: parsedContent
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
    console.error('Error reading or parsing .ini file:', error);
  }
}

// WebSocket server handling connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // **Added handling for 'show-drag-area' command**
      if (data.command === 'show-drag-area') {
        wsClient = ws; // Save the WebSocket client that requested the drag-and-drop
        // Send IPC message to switch to drag-drop mode
        mainWindow.webContents.send('switch-mode', 'drag-drop');
      } else if (data.type === 'getStageTimes' && data.RaceDate) {
        getStageTimesAfterDate(data.RaceDate, (stageTimes) => {
          ws.send(JSON.stringify({ type: 'stageTimes', data: stageTimes }));
        });
      } else if (data.deviceId) {
        const deviceId = data.deviceId;
        clients[deviceId] = ws;
        console.log(`Device ID received: ${deviceId}`);

        if (!clientFiles[deviceId]) {
          clientFiles[deviceId] = new Set();
        }
        sendAllFilesToClient(deviceId)
        sendMissingFiles(deviceId);
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

function getStageTimesAfterDate(raceDate, raceDateTime, callback) {
  // Concatenate date and time fields and compare as a single integer value
  const query = `
    SELECT * FROM F_RallyResult 
    WHERE CAST(RaceDate || RaceDateTime AS INTEGER) > CAST(? AS INTEGER)
  `;

  // Combine RaceDate and RaceDateTime as a single value for comparison
  const combinedDateTime = `${raceDate}${raceDateTime}`;
  console.log(`Executing query for combined datetime: ${combinedDateTime}`);
  
  db.all(query, [combinedDateTime], (err, rows) => {
    if (err) {
      console.error('Error querying stage times:', err);
      callback([]);
      return;
    }

    // Log and pass back the query results
    console.log("Query results:", JSON.stringify(rows, null, 2));
    callback(rows);
  });
}

// Function to send all available .ini files to a specific client
function sendAllFilesToClient(deviceId) {
  const client = clients[deviceId];
  if (!client) return;

  // Clear the client's sent files set to resend all files
  clientFiles[deviceId] = new Set();

  const pacenotePath = path.join(folderPath, 'Plugins', 'NGPCarMenu', 'MyPacenotes');
  const files = fs.readdirSync(pacenotePath);

  files.forEach((file) => {
    const filePath = path.join(pacenotePath, file);
    if (file.endsWith('.ini') && fs.existsSync(filePath)) {
      const relativePath = path.relative(pacenotePath, filePath);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const parsedContent = ini.parse(fileContent);

      const jsonContent = {
        path: relativePath,
        data: parsedContent
      };

      sendToClient(deviceId, jsonContent); // Send each .ini file to the client
    }
  });

  console.log(`Resent all available files to device ${deviceId}`);
}

function sendToClient(deviceId, jsonContent) {
  const client = clients[deviceId];
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(jsonContent));
    console.log(`Sent file to device ${deviceId}:`, jsonContent);
  }
}

function sendMissingFiles(deviceId) {
  const client = clients[deviceId];
  if (!clientFiles[deviceId]) clientFiles[deviceId] = new Set();

  sentFiles.forEach(filePath => {
    const relativePath = path.relative(folderPath, filePath);
    if (!clientFiles[deviceId].has(filePath)) {
      sendToClient(deviceId, {
        path: relativePath,
        data: ini.parse(fs.readFileSync(filePath, 'utf-8'))
      });
      clientFiles[deviceId].add(filePath);
    }
  });
}

app.on('before-quit', () => {
  bonjour.unpublishAll(() => {
    bonjour.destroy();
  });
});
