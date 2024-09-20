const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');

let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];
let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Will be set based on your role

const configuration = {
    iceServers: [
        {
            urls: ["stun:fr-turn1.xirsys.com"]
        },
        {
            username: "your_xirsys_username",
            credential: "your_xirsys_credential",
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

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        socketReady = false;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
    
        // Attempt to reconnect only if the disconnection was unintentional
        if (!intentionalDisconnect && reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
            reconnectAttempts++;
            setTimeout(setupWebSocket, reconnectInterval);
        } else {
            console.error('Max reconnect attempts reached or intentional disconnect. Please refresh the page.');
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onmessage = handleIncomingMessage;
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15000); // Every 15 seconds
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
    sendMessage({ 
        type: 'blur-preference', 
        wantsBlurOff: localWantsBlurOff,
        isAccepting: remoteWantsBlurOff // This indicates if we're accepting a remote request
    });
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
        removeBlurButton.disabled = true;
    } else if (localWantsBlurOff && !remoteWantsBlurOff) {
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Waiting for partner accept';
        removeBlurButton.style.backgroundColor = '';
        removeBlurButton.style.color = '';
        removeBlurButton.disabled = true;
    } else if (!localWantsBlurOff && remoteWantsBlurOff) {
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Remove Blur';
        removeBlurButton.style.backgroundColor = 'green';
        removeBlurButton.style.color = 'white';
        removeBlurButton.disabled = false;
        addMessageToChat('System', "Your partner wants to remove blur. Click 'Remove Blur' to accept.");
    } else {
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Remove Blur';
        removeBlurButton.style.backgroundColor = '';
        removeBlurButton.style.color = '';
        removeBlurButton.disabled = false;
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

    switch (data.type) {
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
            if (data.isAccepting && localWantsBlurOff) {
                // Both peers have agreed to remove blur
                localWantsBlurOff = true;
                remoteWantsBlurOff = true;
            }
            updateBlurState();
            break;
        case 'chat':
            addMessageToChat('Peer', data.message);
            break;
        case 'audio-state':
            addMessageToChat('System', `Your partner has ${data.enabled ? 'enabled' : 'disabled'} their audio.`);
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
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.onnegotiationneeded = null;

        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo) {
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
    }
    // Reset blur state
    remoteWantsBlurOff = false;
    updateBlurState();
    console.log('Disconnected from peer');

    // Automatically attempt to find a new partner
    intentionalDisconnect = false; // Ensure the flag is false
    sendMessage({ type: 'ready' });
}

function startConnection(isOfferer) {
    polite = !isOfferer; // If you're the offerer, you're impolite
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    createPeerConnection();

    console.log(isOfferer ? 'Starting as offerer' : 'Starting as answerer; waiting for offer');
    // Do not create an offer here; it will be handled by onnegotiationneeded
}

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
        // Flush any queued ICE candidates
        await flushIceCandidatesQueue();
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
        } catch (error) {
            console.error('Error during negotiationneeded event:', error);
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
            const sender = peerConnection.addTrack(track, localStream);
            if (track.kind === 'audio') {
                sender.setParameters({
                    ...sender.getParameters(),
                    encodings: [{ dtx: true }] // Enable Discontinuous Transmission for audio
                });
            }
        });
    } else {
        console.error('Local stream not available when creating peer connection');
    }

    console.log('Peer connection created');
    return peerConnection;
}

let isAudioEnabled = false;
const toggleAudioButton = document.getElementById('toggleAudioButton');

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        // Mute audio by default
        localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
        console.log('Local stream set up successfully');
    } catch (error) {
        console.error('Error setting up local stream:', error);
    }
}

function toggleAudio() {
    if (localStream) {
        isAudioEnabled = !isAudioEnabled;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioEnabled;
        });
        toggleAudioButton.textContent = isAudioEnabled ? 'Disable Audio' : 'Enable Audio';
        notifyAudioStateChange();
    }
}

function notifyAudioStateChange() {
    sendMessage({ type: 'audio-state', enabled: isAudioEnabled });
}

// Add this to your initialization code
toggleAudioButton.addEventListener('click', toggleAudio);

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
    
    if (sender === 'System') {
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#888';
    }
    
    messageElement.textContent = `${sender === 'System' ? '' : sender + ': '}${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}