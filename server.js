const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage (Ephemeral - resets on restart)
const activeRooms = {};

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    // 1. Create Room
    socket.on('createRoom', ({ roomName, password }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        activeRooms[roomId] = {
            creatorId: socket.id,
            guestId: null,
            password: password,
            roomName: roomName
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, roomName });
        console.log(`[CREATE] Room ${roomId} created.`);
    });

    // 2. Join Room
    socket.on('joinRoom', ({ roomId, password }) => {
        const room = activeRooms[roomId.toUpperCase()];
        
        if (!room) return socket.emit('error', 'Room not found.');
        if (room.guestId !== null) {
            io.to(roomId).emit('systemMessage', `⚠️ Blocked: User ${socket.id.substring(0,5)}... tried to join.`);
            return socket.emit('error', 'ACCESS DENIED: Room Full.');
        }
        if (room.password !== password) return socket.emit('error', 'INVALID PASSWORD.');

        room.guestId = socket.id;
        socket.join(roomId);
        
        io.to(roomId).emit('userJoined', { userId: socket.id });
        socket.emit('joinSuccess', { roomId, roomName: room.roomName });
    });

    // 3. Send Message
    socket.on('sendMessage', ({ roomId, message }) => {
        socket.to(roomId).emit('receiveMessage', {
            senderId: socket.id,
            message: message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    // 4. Typing
    socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('userTyping', { userId: socket.id, isTyping });
    });

    // 5. Leave/Terminate
    socket.on('leaveChat', ({ roomId }) => {
        io.to(roomId).emit('sessionTerminated', 'SESSION TERMINATED BY USER.');
        delete activeRooms[roomId];
    });

    // 6. Disconnect
    socket.on('disconnect', () => {
        for (const [roomId, room] of Object.entries(activeRooms)) {
            if (room.creatorId === socket.id || room.guestId === socket.id) {
                io.to(roomId).emit('sessionTerminated', 'PEER DISCONNECTED. SESSION ENDED.');
                delete activeRooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`IPChat running on port ${PORT}`);
});