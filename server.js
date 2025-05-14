const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Trong production, hạn chế domain
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Middleware xác thực cho socket
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }

        // Xác thực token với Laravel API
        try {
            const response = await axios.get(`${process.env.LARAVEL_API_URL}/user`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            socket.user = response.data;
            next();
        } catch (error) {
            return next(new Error('Authentication error: Invalid token'));
        }
    } catch (error) {
        next(new Error('Authentication error'));
    }
});

// Xử lý kết nối
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.name} (${socket.user.id})`);

    // Tham gia phòng (mặc định là 'general')
    socket.on('join-room', (roomId = 'general') => {
        // Rời khỏi các phòng khác (nếu có)
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }

        socket.join(roomId);
        socket.currentRoom = roomId;
        console.log(`${socket.user.name} joined room: ${roomId}`);

        // Thông báo cho phòng có người dùng mới tham gia
        socket.to(roomId).emit('user-joined', {
            user: {
                id: socket.user.id,
                name: socket.user.name
            },
            message: `${socket.user.name} has joined the room.`
        });
    });

    // Nhận tin nhắn và broadcast
    socket.on('send-message', async (messageData) => {
        if (!socket.currentRoom) {
            socket.emit('error', { message: 'You must join a room first' });
            return;
        }

        try {
            // Gửi tin nhắn đến Laravel API để lưu vào DB
            const response = await axios.post(
                `${process.env.LARAVEL_API_URL}/messages`,
                {
                    room_id: socket.currentRoom,
                    message: messageData.message
                },
                {
                    headers: {
                        'Authorization': `Bearer ${socket.handshake.auth.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Broadcast tin nhắn đến tất cả người dùng trong phòng (bao gồm người gửi)
            io.to(socket.currentRoom).emit('new-message', response.data);
        } catch (error) {
            console.error('Error saving message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    // Xử lý 'typing' events
    socket.on('typing', (isTyping) => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('user-typing', {
                user: {
                    id: socket.user.id,
                    name: socket.user.name
                },
                isTyping
            });
        }
    });

    // Xử lý ngắt kết nối
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.user.name}`);
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('user-left', {
                user: {
                    id: socket.user.id,
                    name: socket.user.name
                },
                message: `${socket.user.name} has left the room.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Socket.io server running on port ${PORT}`);
}); 