-- Supabase Migration: Fix RLS Policies for Anonymous Access
-- Run this in your Supabase SQL Editor

-- ============================================
-- 1. Fix master_images Table RLS Policies
-- ============================================

-- Allow anonymous INSERT for master_images
CREATE POLICY IF NOT EXISTS "Allow anonymous insert for master_images" ON master_images
    FOR INSERT WITH CHECK (true);

-- Allow anonymous UPDATE for master_images
CREATE POLICY IF NOT EXISTS "Allow anonymous update for master_images" ON master_images
    FOR UPDATE USING (true);

-- Allow anonymous DELETE for master_images
CREATE POLICY IF NOT EXISTS "Allow anonymous delete for master_images" ON master_images
    FOR DELETE USING (true);

-- ============================================
-- 2. Storage Bucket Policies (Manual Step)
-- ============================================
-- NOTE: Storage policies must be configured in Supabase Dashboard!
-- 
-- Go to: Storage > game-images bucket > Policies
-- Add the following policies:
--
-- For INSERT (uploads):
--   - Policy Name: "Allow public uploads"
--   - Target Roles: All (or anon)
--   - Definition: true
--
-- For SELECT (downloads):
--   - Policy Name: "Allow public downloads"
--   - Target Roles: All (or anon)
--   - Definition: true
--
-- For UPDATE:
--   - Policy Name: "Allow public updates"
--   - Target Roles: All (or anon)
--   - Definition: true
--
-- For DELETE:
--   - Policy Name: "Allow public deletes"
--   - Target Roles: All (or anon)
--   - Definition: true
