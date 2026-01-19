-- Migration: Allow anonymous room creation for development

-- Update rooms policy to allow anyone to create a room
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON rooms;
CREATE POLICY "Anyone can create rooms" ON rooms
    FOR INSERT WITH CHECK (true);

-- Ensure admin_id is nullable (it is by default, but let's be explicit if needed)
-- Note: ForeignKey constraint on auth.users(id) still exists but will pass with NULL values.
