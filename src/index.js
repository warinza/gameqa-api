import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CORS Configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO Configuration
const io = new Server(httpServer, {
  cors: corsOptions
});

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In-memory game state (can be moved to Redis for scale)
const rooms = new Map();

// ========== REST API Routes ==========

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all master images
app.get('/api/images', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('master_images')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new room
app.post('/api/rooms', async (req, res) => {
  try {
    const { adminId, imageIds, settings } = req.body;
    const roomCode = generateRoomCode();

    // Fetch full image data for the selected images
    const { data: fullImages, error: imagesError } = await supabase
      .from('master_images')
      .select('id, original_url, modified_url, differences')
      .in('id', imageIds);

    if (imagesError) throw imagesError;

    // Maintain the order requested by the user
    const orderedImages = imageIds.map(id => fullImages.find(img => img.id === id)).filter(Boolean);

    const { data, error } = await supabase
      .from('rooms')
      .insert({
        code: roomCode,
        status: 'LOBBY',
        admin_id: adminId,
        image_queue: orderedImages, // Store full data in DB as well
        settings: settings || { timerPerImage: 60 },
        current_image_idx: 0
      })
      .select()
      .single();

    if (error) throw error;

    // Initialize in-memory room state
    rooms.set(roomCode, {
      id: data.id,
      code: roomCode,
      status: 'LOBBY',
      players: [],
      imageQueue: orderedImages,
      currentImageIdx: 0,
      settings: settings || { timerPerImage: 60 },
      foundDifferences: {}, // { imageId: { diffId: playerId } }
      timerId: null
    });

    res.json({ ...data, joinUrl: `/join/${roomCode}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get room by code
app.get('/api/rooms/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const room = rooms.get(code);
    
    if (!room) {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single();

      if (error) throw error;
      res.json(data);
    }
  } catch (error) {
    res.status(404).json({ error: 'Room not found' });
  }
});

// Delete a room (Service Role)
app.delete('/api/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params;
  try {
    // Delete players first (Manual cascade)
    await supabase.from('players').delete().eq('room_id', roomId);
    
    // Delete room
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting room:', err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// Clear players from a room (Service Role)
app.delete('/api/rooms/:roomId/players', async (req, res) => {
  const { roomId } = req.params;
  try {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('room_id', roomId);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Error clearing players:', err);
    res.status(500).json({ error: 'Failed to clear players' });
  }
});

// ========== Socket.IO Events ==========

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Player joins a room
  socket.on('join_room', async ({ roomCode, playerId, nickname, avatar }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Use stable playerId if provided, otherwise fallback to existing (for safety)
    const pid = playerId || uuidv4();

    // Check if player already exists in memory
    let player = room.players.find(p => p.id === pid);
    
    if (player) {
        // Reconnect logic: update socketId
        player.socketId = socket.id;
        player.isOnline = true;
    } else {
        player = {
            id: pid,
            socketId: socket.id,
            nickname,
            avatar,
            score: 0,
            isOnline: true
        };
        room.players.push(player);
    }
    socket.join(roomCode);

    // Notify all players in the room
    io.to(roomCode).emit('room_state', {
      players: room.players,
      status: room.status,
      imageQueue: room.imageQueue,
      currentImageIdx: room.currentImageIdx
    });

    // Save player to DB (Upsert to prevent duplicates)
    await supabase.from('players').upsert({
      id: player.id,
      room_id: room.id,
      nickname,
      avatar_id: avatar,
      socket_id: socket.id,
      score: player.score || 0,
      is_online: true
    });

    console.log(`${nickname} joined room ${roomCode}`);
  });

  // Admin starts the match
  socket.on('admin_start_match', async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.status = 'PLAYING';
    room.currentImageIdx = 0;
    room.foundDifferences = {};

    // Update DB
    await supabase
      .from('rooms')
      .update({ status: 'PLAYING', current_image_idx: 0 })
      .eq('code', roomCode);

    // Broadcast game start
    io.to(roomCode).emit('game_start', {
      startTime: Date.now(),
      currentImage: room.imageQueue[0],
      timer: room.settings.timerPerImage
    });

    // Start timer for image change
    startImageTimer(roomCode);
  });

  // Player found a difference
  socket.on('player_found_diff', async ({ roomCode, diffId, imageId }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'PLAYING') return;

    // Check if difference already found
    if (!room.foundDifferences[imageId]) {
      room.foundDifferences[imageId] = {};
    }

    if (room.foundDifferences[imageId][diffId]) {
      socket.emit('diff_already_found', { diffId });
      return;
    }

    // Find player and update score
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.score += 10;
    room.foundDifferences[imageId][diffId] = player.id;

    // Broadcast to all players
    io.to(roomCode).emit('diff_found', {
      playerId: player.id,
      playerName: player.nickname,
      diffId,
      newScore: player.score,
      allScores: room.players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score }))
    });

    // Update DB
    await supabase
      .from('players')
      .update({ score: player.score })
      .eq('id', player.id);

    // Check if all differences found for this image
    const currentImage = room.imageQueue[room.currentImageIdx];
    const foundCount = Object.keys(room.foundDifferences[imageId]).length;
    const totalCount = currentImage.differences ? currentImage.differences.length : 0;

    if (foundCount >= totalCount && totalCount > 0) {
      console.log(`All differences found for image ${imageId}! Switching...`);
      moveToNextImage(roomCode);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    rooms.forEach((room, code) => {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        // Remove player from in-memory state
        room.players.splice(playerIndex, 1);
        
        // Broadcast update
        io.to(code).emit('room_state', {
          players: room.players,
          status: room.status,
          imageQueue: room.imageQueue,
          currentImageIdx: room.currentImageIdx
        });
        
        console.log(`${player.nickname} removed from room ${code}`);
      }
    });
  });

  // Admin closes the room
  socket.on('admin_close_room', async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Notify everyone
    io.to(roomCode).emit('room_closed');

    // Cleanup in-memory
    rooms.delete(roomCode);

    // Update DB status
    await supabase
      .from('rooms')
      .update({ status: 'CLOSED' })
      .eq('code', roomCode);

    // Clear players from DB for this room
    await supabase.from('players').delete().eq('room_id', room.id);

    console.log(`Room ${roomCode} closed by admin`);
  });
});

// ========== Helper Functions ==========

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function startImageTimer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Clear any existing timer
  if (room.timerId) {
    clearTimeout(room.timerId);
  }

  const timer = room.settings.timerPerImage * 1000;

  room.timerId = setTimeout(async () => {
    moveToNextImage(roomCode);
  }, timer);
}

async function moveToNextImage(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || (room.status !== 'PLAYING' && room.status !== 'LOBBY')) return;

  // Clear timer
  if (room.timerId) {
    clearTimeout(room.timerId);
    room.timerId = null;
  }

  room.currentImageIdx++;

  // Check if game is over
  if (room.currentImageIdx >= room.imageQueue.length) {
    room.status = 'FINISHED';
    
    await supabase
      .from('rooms')
      .update({ status: 'FINISHED' })
      .eq('code', roomCode);

    io.to(roomCode).emit('game_over', {
      finalScores: room.players
        .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
        .sort((a, b) => b.score - a.score)
    });
    return;
  }

  // Move to next image
  await supabase
    .from('rooms')
    .update({ current_image_idx: room.currentImageIdx })
    .eq('code', roomCode);

  io.to(roomCode).emit('image_change', {
    currentImage: room.imageQueue[room.currentImageIdx],
    timer: room.settings.timerPerImage,
    imageIndex: room.currentImageIdx
  });

  // Start next timer
  startImageTimer(roomCode);
}

// ========== Start Server ==========

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
