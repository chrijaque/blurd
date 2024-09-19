const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');

let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];

const configuration = {
    iceServers: [{
        urls: [ "stun:fr-turn1.xirsys.com" ]
     }, {
        username: "NtUxUgJUFwDb1LrBQAXzLGpsqx9PBXQQnEa0a1s2LL3T93oSqD2a3jC1gqM1SG27AAAAAGbjXnBjaHJpamFxdWU=",
        credential: "d11f86be-714e-11ef-8726-0242ac120004",
        urls: [
            "turn:fr-turn1.xirsys.com:80?transport=udp",
            "turn:fr-turn1.xirsys.com:3478?transport=udp",
            "turn:fr-turn1.xirsys.com:80?transport=tcp",
            "turn:fr-turn1.xirsys.com:3478?transport=tcp",
            "turns:fr-turn1.xirsys.com:443?transport=tcp",
            "turns:fr-turn1.xirsys.com:5349?transport=tcp"
        ]
        }
    ],
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 0, // Disable pre-gathering
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};

// WebSocket setup
let socket;
let socketReady = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 5000;
let heartbeatInterval;
let intentionalDisconnect = false; // Added flag to track intentional disconnects

 function setupWebSocket() {
        socket = new WebSocket('wss://blurd.adaptable.app');
    
        socket.onopen = () => {
            console.log('WebSocket connected');
            socketReady = true;
            reconnectAttempts = 0;
            intentionalDisconnect = false; // Reset the flag on successful connection
    
            sendMessage({ type: 'ready' });
            // Start the heartbeat interval after the socket is open
            startHeartbeat();
        };
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        socketReady = false;
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        // Attempt to reconnect only if the disconnection was unintentional
        if (!intentionalDisconnect && reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
            setTimeout(setupWebSocket, reconnectInterval);
            reconnectAttempts++;
        } else {
            console.error('Max reconnect attempts reached or intentional disconnect. Please refresh the page.');
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    socket.onmessage = handleIncomingMessage;

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        }
    }, 5000); // Every 5 seconds
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM fully loaded');
    await initializeConnection();
    setupWebSocket();
    setupChat();
    setupBlurEffect();
});

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
let removeBlurButton;

function setupBlurEffect() {
    removeBlurButton = document.getElementById('removeBlurButton');
    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', toggleBlur);
        console.log('Blur effect setup complete');
    } else {
        console.error('Remove blur button not found');
        // Attempt to find the button by other means
        const buttons = document.getElementsByTagName('button');
        for (let button of buttons) {
            if (button.textContent.toLowerCase().includes('remove blur')) {
                removeBlurButton = button;
                removeBlurButton.addEventListener('click', toggleBlur);
                console.log('Remove blur button found and set up');
                break;
            }
        }
    }
    applyInitialBlur();
}

function applyInitialBlur() {
    if (localVideo) localVideo.style.filter = 'blur(10px)';
    if (remoteVideo) remoteVideo.style.filter = 'blur(10px)';
    console.log('Initial blur applied');
}

function toggleBlur() {
    console.log('Toggle blur called');
    if (!removeBlurButton || removeBlurButton.disabled) {
        console.log('Remove blur button is disabled or not found');
        return;
    }
    localWantsBlurOff = !localWantsBlurOff;
    updateBlurState();
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    console.log('Updating blur state:', { localWantsBlurOff, remoteWantsBlurOff });

    if (localWantsBlurOff && remoteWantsBlurOff) {
        localVideo.style.filter = 'none';
        remoteVideo.style.filter = 'none';
        removeBlurButton.textContent = 'DAAAAMN!';
        removeBlurButton.style.backgroundColor = 'blue';
        removeBlurButton.style.color = 'white';
        removeBlurButton.disabled = true; // Disable the button
    } else {
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Remove Blur';
        removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? 'green' : '';
        removeBlurButton.style.color = '';
        removeBlurButton.disabled = false; // Enable the button
    }
    console.log('Blur state updated');
}

function setupChat() {
    console.log('Setting up chat');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendMessageButton');
    const chatMessages = document.getElementById('chatMessages');

    if (chatInput && sendButton && chatMessages) {
        sendButton.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendChatMessage();
            }
        });
    } else {
        console.error('Some chat elements are missing');
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) {
        console.error('Chat input element not found');
        return;
    }
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

let isConnectedToPeer = false;

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    if (data.type === 'pong') {
        // Connection is alive
        return;
    }

    switch(data.type) {
        case 'waiting':
            console.log('Waiting for peer...');
            isConnectedToPeer = false;
            if (statusMessage) {
                statusMessage.textContent = 'Waiting for a peer...';
            } else {
                console.error('statusMessage element not found');
            }
            break;
            case 'paired':
                console.log('Paired with a new peer');
                isConnectedToPeer = true;
                if (statusMessage) {
                    statusMessage.textContent = 'Connected to a peer';
                } else {
                    console.error('statusMessage element not found');
                }
                startConnection(data.isOfferer); // Use the isOfferer flag from the server
                break;
        case 'partnerDisconnected':
            console.log('Partner disconnected');
            if (statusMessage) {
                statusMessage.textContent = 'Partner disconnected';
            } else {
                console.error('statusMessage element not found');
            }
            handlePartnerDisconnect();
            break;
        case 'offer':
            console.log('Received offer');
            handleOffer(data.offer);
            break;
        case 'answer':
            console.log('Received answer');
            handleAnswer(data.answer);
            break;
        case 'ice-candidate':
            console.log('Received ICE candidate');
            handleIceCandidate(data.candidate);
            break;
        case 'blur-preference':
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
            break;
        case 'chat':
            addMessageToChat('Peer', data.message);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handlePartnerDisconnect() {
    if (!isConnectedToPeer) return;
    isConnectedToPeer = false;
    console.log('Handling partner disconnect');

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }
    // Reset blur state
    remoteWantsBlurOff = false;
    updateBlurState();
    console.log('Disconnected from peer');

    // Prompt user to decide next action
    if (confirm('Your partner has disconnected. Would you like to find a new partner?')) {
        intentionalDisconnect = false; // Reset the flag
        sendMessage({ type: 'ready' });
    } else {
        // User chooses not to find a new partner
        intentionalDisconnect = true;
        sendMessage({ type: 'disconnected' });
        if (socket) socket.close(); // Close the WebSocket connection
    }
}

function startConnection(isOfferer) {
    polite = !isOfferer;
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    createPeerConnection();

    if (isOfferer) {
        console.log('Starting as offerer');
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error creating offer:', error));
    } else {
        console.log('Starting as answerer; waiting for offer');
    }

}

// Modify your existing nextButton event listener
nextButton.addEventListener('click', () => {
    console.log('Next button clicked');
    sendMessage({ type: 'next' });
    handlePartnerDisconnect();
    // Do not close the WebSocket
});

disconnectButton.addEventListener('click', () => {
    console.log('Disconnect button clicked');
    intentionalDisconnect = true;
    sendMessage({ type: 'disconnected' });
    handlePartnerDisconnect();
    if (socket) socket.close(); // Close the WebSocket only on full disconnect
});

let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Set this based on your role

async function handleOffer(offer) {
    try {
        const offerCollision = makingOffer || peerConnection.signalingState != "stable";

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
            console.log('Ignoring offer due to collision');
            return;
        }

        console.log('Handling offer');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage({ type: 'answer', answer: peerConnection.localDescription });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

function handleIceCandidate(candidate) {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        addIceCandidate(candidate);
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

async function addIceCandidate(candidate) {
    try {
        await peerConnection.addIceCandidate(candidate);
        console.log('ICE candidate added successfully');
    } catch (e) {
        console.error('Error adding received ice candidate', e);
    }
}

async function flushIceCandidatesQueue() {
    console.log('Flushing ICE candidates queue');
    while (iceCandidatesQueue.length) {
        const candidate = iceCandidatesQueue.shift();
        await addIceCandidate(candidate);
    }
}

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        console.log('Sent message:', message);
    } else {
        console.warn('WebSocket is not open. Message not sent:', message);
        // Optionally, you could queue messages here to send when the connection is ready
    }
}

function createPeerConnection() {
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    console.log('Creating new peer connection');
    peerConnection = new RTCPeerConnection(configuration);

    // Add the onnegotiationneeded event handler here
    peerConnection.onnegotiationneeded = async () => {
        try {
            makingOffer = true;
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        } catch (err) {
            console.error('Error during negotiationneeded event:', err);
        } finally {
            makingOffer = false;
        }
    };

    // Existing event handlers
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = event => {
        console.log('Received remote track', event);
        if (remoteVideo && event.streams && event.streams[0]) {
            console.log('Setting remote video stream');
            remoteVideo.srcObject = event.streams[0];
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        updateConnectionStatus();
    };

    peerConnection.onsignalingstatechange = () => {
        console.log('Signaling state:', peerConnection.signalingState);
    };

    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.error('Local stream not available when creating peer connection');
    }

    console.log('Peer connection created');
    return peerConnection;
}

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        console.log('Local stream set up successfully');
    } catch (error) {
        console.error('Error setting up local stream:', error);
    }
}

// Wrap the initialization in an async function
async function initializeConnection() {
    try {
        await setupLocalStream();
        createPeerConnection();
    } catch (error) {
        console.error('Error during initialization:', error);
    }
}

function updateConnectionStatus() {
    const statusMessage = document.getElementById('statusMessage');
    if (peerConnection && peerConnection.iceConnectionState === 'connected') {
        statusMessage.textContent = 'Connected to a peer';
    } else {
        statusMessage.textContent = 'Waiting for peer...';
    }
}

window.onbeforeunload = () => {
    if (peerConnection) peerConnection.close();
    if (socket) socket.close();
};

function addMessageToChat(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}