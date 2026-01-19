-- Supabase Migration: Create tables for Spot the Difference Game
-- Run this in your Supabase SQL Editor

-- Master Images Table
CREATE TABLE IF NOT EXISTS master_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    differences JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'PLAYING', 'FINISHED')),
    admin_id UUID REFERENCES auth.users(id),
    image_queue JSONB DEFAULT '[]',
    settings JSONB DEFAULT '{"timerPerImage": 60}',
    current_image_idx INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players Table
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    avatar_id TEXT,
    socket_id TEXT,
    score INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE master_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Allow read access to master_images for all authenticated users
CREATE POLICY "Public read access for master_images" ON master_images
    FOR SELECT USING (true);

-- Allow insert/update for authenticated admins
CREATE POLICY "Admin can manage master_images" ON master_images
    FOR ALL USING (auth.role() = 'authenticated');

-- Rooms policies
CREATE POLICY "Anyone can read rooms" ON rooms
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create rooms" ON rooms
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin can update their rooms" ON rooms
    FOR UPDATE USING (admin_id = auth.uid());

-- Players policies
CREATE POLICY "Anyone can read players" ON players
    FOR SELECT USING (true);

CREATE POLICY "Anyone can insert players" ON players
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Players can update their own record" ON players
    FOR UPDATE USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id);
