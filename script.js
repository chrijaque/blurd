// Landing page elements
const localVideoPreview = document.getElementById('localVideoPreview');
const toggleBlurButton = document.getElementById('toggleBlurButton');
const usernameInput = document.getElementById('usernameInput');
const termsCheckbox = document.getElementById('termsCheckbox');
const startChatButton = document.getElementById('startChatButton');

// Chat interface elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');
const removeBlurButton = document.getElementById('removeBlurButton');
const toggleAudioButton = document.getElementById('toggleAudioButton');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendMessageButton');
const chatMessages = document.getElementById('chatMessages');

// Variables
let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];
let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Will be set based on your role
let isBlurred = true; // For preview
let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
let localRequestSent = false;
let remoteRequestReceived = false;
let isConnectedToPeer = false;
let dataChannel;
let isAudioEnabled = false;
let username = '';

// WebSocket setup
let ws;
let socketReady = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 5000;
let heartbeatInterval;
let intentionalDisconnect = false; // Added flag to track intentional disconnects

// Landing Page Functions
async function setupLocalPreview() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localVideoPreview.srcObject = localStream;
        applyBlurEffectPreview();
    } catch (error) {
        alert('Unable to access camera. Please ensure you have given permission and try again.');
    }
}

function applyBlurEffectPreview() {
    localVideoPreview.style.filter = isBlurred ? 'blur(10px)' : 'none';
}

toggleBlurButton.addEventListener('click', () => {
    isBlurred = !isBlurred;
    applyBlurEffectPreview();
});

function updateStartChatButton() {
    startChatButton.disabled = !(usernameInput.value.trim() && termsCheckbox.checked);
}

usernameInput.addEventListener('input', updateStartChatButton);
termsCheckbox.addEventListener('change', updateStartChatButton);

startChatButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && termsCheckbox.checked) {
        localStorage.setItem('username', username);
        startChat();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    setupLocalPreview();
    updateStartChatButton(); // Initial check
});

// Chat Initialization Functions
function initializeChat() {
    // Display the username if needed
    const username = localStorage.getItem('username');
    if (username) {
        console.log(`Welcome, ${username}!`);
    }

    // Set initial blur preference
    localWantsBlurOff = false; // Change this line to ensure blur is on by default

    // Initialize chat functionalities
    setupWebSocket();       // WebSocket setup before peer connection
    setupChat();
    setupBlurEffect();
    initializeConnection(); // Get local media stream
}

async function initializeConnection() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        // Do not call createPeerConnection() here
    } catch (error) {
        console.error('Error setting up local stream:', error);
    }
}

function createPeerConnection() {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
            }
        ],
        iceCandidatePoolSize: 10,
    };

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = event => {
        if (event.track.kind === 'video') {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                
                // Add this to ensure the video plays
                remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
            }
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            makingOffer = true;
            await peerConnection.setLocalDescription();
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        } catch (err) {
            console.error('Error during negotiation:', err);
        } finally {
            makingOffer = false;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed') {
            restartIce();
        } else if (peerConnection.iceConnectionState === 'connected') {
            checkRelayConnection();
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            setTimeout(restartIce, 2000);
        }
    };

    peerConnection.onconnectionstatechange = () => {
    };

    peerConnection.onicegatheringstatechange = () => {
    };

    // Set up data channel based on role
    if (!polite) {
        // Offerer creates the data channel
        dataChannel = peerConnection.createDataChannel('chat');
        setupDataChannel();
    } else {
        // Answerer listens for data channel
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel();
        };
    }
}

function setupWebSocket() {
    ws = new WebSocket('wss://blurd.adaptable.app');

    ws.onopen = () => {
        console.log('WebSocket connected');
        // Send a ready message when connected
        sendMessage({ type: 'ready', username: localStorage.getItem('username') });
    };

    ws.onmessage = handleWebSocketMessage;

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(setupWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15000); // Every 15 seconds
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        console.log('Sent message:', message);
    } else {
        console.error('WebSocket is not open. Cannot send message:', message);
    }
}

function handleWebSocketMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Received WebSocket message:', message);

    switch (message.type) {
        case 'waiting':
            console.log('Waiting for peer...');
            isConnectedToPeer = false;
            if (statusMessage) {
                statusMessage.textContent = 'Waiting for a peer...';
            }
            break;
        case 'paired':
            console.log('Paired with a new peer');
            isConnectedToPeer = true;
            if (statusMessage) {
                statusMessage.textContent = 'Connected to a peer';
            }
            polite = !message.isOfferer; // Corrected assignment
            startConnection(message.isOfferer);
            clearChat();
            resetBlurState();
            break;
        case 'partnerDisconnected':
            console.log('Partner disconnected');
            if (statusMessage) {
                statusMessage.textContent = 'Partner disconnected';
            }
            handlePartnerDisconnect();
            break;
        case 'offer':
            handleOfferOrAnswer(new RTCSessionDescription(message.offer), true);
            break;
        case 'answer':
            handleOfferOrAnswer(new RTCSessionDescription(message.answer), false);
            break;
        case 'ice-candidate':
            handleIceCandidate(message.candidate);
            break;
        case 'chat':
            handleChatMessage(message.message);
            break;
        case 'audio-state':
            addMessageToChat('System', `Your partner has ${message.enabled ? 'enabled' : 'disabled'} their audio.`);
            break;
        case 'blur_state':
            handleBlurStateUpdate(message);
            break;
        default:
            console.log('Unhandled message type:', message.type);
    }
}

// Peer Connection and RTC Functions
function startConnection(isOfferer) {
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    createPeerConnection();
    
    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // Log media streams after a short delay
    setTimeout(logMediaStreams, 2000);
}

async function handleOfferOrAnswer(description, isOffer) {
    const offerCollision = isOffer &&
                           (makingOffer || peerConnection.signalingState !== "stable");

    ignoreOffer = !polite && offerCollision;
    if (ignoreOffer) {
        console.log('Ignoring offer due to collision');
        return;
    }

    try {
        await peerConnection.setRemoteDescription(description);
        if (isOffer) {
            await peerConnection.setLocalDescription();
            sendMessage({ type: 'answer', answer: peerConnection.localDescription });
        }

        // Add queued ICE candidates after setting remote description
        while (iceCandidatesQueue.length) {
            const candidate = iceCandidatesQueue.shift();
            await peerConnection.addIceCandidate(candidate).catch(e => {
                console.error('Error adding queued ice candidate', e);
            });
        }
    } catch (err) {
        console.error('Error handling offer or answer:', err);
    }
}

function handleIceCandidate(candidate) {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        peerConnection.addIceCandidate(candidate)
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

function setupDataChannel() {
    if (dataChannel) {
        dataChannel.onopen = () => console.log('Data channel opened');
        dataChannel.onclose = () => console.log('Data channel closed');
        dataChannel.onmessage = handleDataChannelMessage;
    } else {
        console.error('Data channel is not available');
    }
}

function handleDataChannelMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Received data channel message:', message);
    if (message.type === 'blur_state') {
        remoteWantsBlurOff = message.wantsBlurOff;
        updateBlurState();
    } else {
        // Handle other message types if necessary
    }
}

// Chat Functions
function setupChat() {

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

    toggleAudioButton.addEventListener('click', toggleAudio);
    nextButton.addEventListener('click', handleNext);
    disconnectButton.addEventListener('click', handleDisconnect);
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

function addMessageToChat(sender, message) {
    const messageElement = document.createElement('div');
    
    if (sender === 'System') {
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#888';
    }
    
    messageElement.textContent = `${sender === 'System' ? '' : sender + ': '}${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
    if (chatMessages) {
        chatMessages.innerHTML = '';
    } else {
        console.error('Chat messages element not found');
    }
}

function resetBlurState() {
    remoteWantsBlurOff = false;
    updateBlurState();
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const removeBlurButton = document.getElementById('removeBlurButton');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    console.log('Updating blur state:', { localWantsBlurOff, remoteWantsBlurOff });

    if (localWantsBlurOff && remoteWantsBlurOff) {
        // Both want to remove blur
        localVideo.style.filter = 'none';
        remoteVideo.style.filter = 'none';
        removeBlurButton.textContent = 'DAAAAMN!';
        removeBlurButton.style.backgroundColor = 'blue';
        removeBlurButton.style.color = 'white';
        removeBlurButton.disabled = true;
    } else if (localWantsBlurOff && !remoteWantsBlurOff) {
        // Local wants to remove blur; waiting for remote
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Cancel Request';
        removeBlurButton.style.backgroundColor = 'yellow';
        removeBlurButton.disabled = false;
    } else if (!localWantsBlurOff && remoteWantsBlurOff) {
        // Remote wants to remove blur; waiting for local confirmation
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Accept Remove Blur';
        removeBlurButton.style.backgroundColor = 'green';
        removeBlurButton.disabled = false;
    } else {
        // Both want blur on
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Remove Blur';
        removeBlurButton.style.backgroundColor = '';
        removeBlurButton.style.color = '';
        removeBlurButton.disabled = false;
    }

    console.log('Blur state updated');
}

function toggleBlur() {
    console.log('Toggle blur clicked. Current state:', localWantsBlurOff);
    localWantsBlurOff = !localWantsBlurOff;
    sendBlurState();
    updateBlurStateAndNotify(true);
}

function sendBlurState() {
    const message = {
        type: 'blur_state',
        wantsBlurOff: localWantsBlurOff,
        username: localStorage.getItem('username')
    };
    console.log('Sending blur state:', message);
    sendMessage(message);
}

function handleBlurStateUpdate(message) {
    console.log('Handling blur state update:', message);
    if (message.username !== localStorage.getItem('username')) {
        remoteWantsBlurOff = message.wantsBlurOff;
        console.log('Updated remote blur state:', remoteWantsBlurOff);
        updateBlurStateAndNotify(false);
    }
}

function updateBlurStateAndNotify(isLocal) {
    updateBlurState();
    
    if (isLocal) {
        if (localWantsBlurOff) {
            addMessageToChat('System', "You requested to remove the blur. Waiting for your partner to accept.");
        } else {
            addMessageToChat('System', "You cancelled your blur removal request.");
        }
    } else {
        if (remoteWantsBlurOff && !localWantsBlurOff) {
            addMessageToChat('System', "Your partner wants to remove the blur. Click 'Remove Blur' to accept.");
        } else if (!remoteWantsBlurOff && localWantsBlurOff) {
            addMessageToChat('System', "Your partner cancelled their blur removal request.");
        } else if (remoteWantsBlurOff && localWantsBlurOff) {
            addMessageToChat('System', "Blur has been removed for both parties.");
        }
    }
}

// Audio Control Functions
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

// Connection Control Functions
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

function handleNext() {
    console.log('Next button clicked');
    clearChat();
    resetBlurState();
    sendMessage({ type: 'next' });
    handlePartnerDisconnect();
    // Do not close the WebSocket
}

function handleDisconnect() {
    console.log('Disconnect button clicked');
    clearChat();
    intentionalDisconnect = true;
    sendMessage({ type: 'disconnected' });
    handlePartnerDisconnect();
    if (ws) ws.close(); // Close the WebSocket only on full disconnect
}

function updateConnectionStatus() {
    if (peerConnection && peerConnection.iceConnectionState === 'connected') {
        statusMessage.textContent = 'Connected to a peer';
    } else {
        statusMessage.textContent = 'Waiting for peer...';
    }
}

window.onbeforeunload = () => {
    if (peerConnection) peerConnection.close();
    if (ws) ws.close();
};

function startChat() {
    const landingPage = document.getElementById('landingPage');
    const chatPage = document.getElementById('chatPage');
    const usernameInput = document.getElementById('usernameInput');

    // Capture the username
    username = usernameInput.value || 'Anonymous';

        // Apply fade-out animation to landing page
        landingPage.classList.add('fade-out');

        // After the fade-out animation completes, hide the landing page and show the chat page
        setTimeout(() => {
            landingPage.style.display = 'none';
            landingPage.classList.remove('fade-out');
    
            // Show the chat page and apply fade-in animation
            chatPage.style.display = 'block';
            chatPage.classList.add('fade-in');
    
            // Remove the fade-in class after the animation completes to reset the state
            setTimeout(() => {
                chatPage.classList.remove('fade-in');
            }, 500); // Match the duration of the fade-in animation
    
            // Proceed with initializing the chat functionalities
            initializeChat();
        }, 500); // Match the duration of the fade-out animation
    }


function setupBlurEffect() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const removeBlurButton = document.getElementById('removeBlurButton');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    // Apply initial blur
    localVideo.style.filter = 'blur(10px)';
    remoteVideo.style.filter = 'blur(10px)';

    removeBlurButton.addEventListener('click', toggleBlur);
}

function restartIce() {
    if (peerConnection) {
        peerConnection.restartIce();
        peerConnection.createOffer({ iceRestart: true })
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error during ICE restart:', error));
    }
}


function forceRelayICECandidates() {
    if (peerConnection) {
        peerConnection.getTransceivers().forEach(transceiver => {
            transceiver.sender.setParameters({
                ...transceiver.sender.getParameters(),
                encodings: [{ networkPriority: 'low' }]
            });
        });
    }
}

// Call these functions periodically
setInterval(checkConnectionStatus, 30000);
setInterval(checkRelayConnection, 30000);

// Add these function definitions at the appropriate place in your script

function checkConnectionStatus() {
    // Implement connection status check logic
    console.log('Checking connection status...');
    // Add your implementation here
}

function logMediaStreams() {
    // Implement media stream logging logic
    console.log('Logging media streams...');
    // Add your implementation here
}

function handleChatMessage(message) {
    console.log('Received chat message:', message);
    const chatBox = document.getElementById('chatBox');
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-box'; // Add the chat-box class
    messageElement.textContent = `Partner: ${message}`;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to the bottom
}

// Update the sendMessage function to use the correct id and class
function sendMessage() {
    const messageInput = document.getElementById('messageInput'); // Assuming this is the correct id
    const message = messageInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'chat', message: message }));
        displayMessage('You', message); // Display your own message
        messageInput.value = ''; // Clear the input field
    }
}

function displayMessage(sender, message) {
    const chatBox = document.getElementById('chatBox');
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-box'; // Add the chat-box class
    messageElement.textContent = `${sender}: ${message}`;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to the bottom
}
