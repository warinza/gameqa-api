-- Supabase Migration: Update schema for dual image system
-- Run this in your Supabase SQL Editor

-- Add columns for original and modified images
ALTER TABLE master_images 
ADD COLUMN IF NOT EXISTS original_url TEXT,
ADD COLUMN IF NOT EXISTS modified_url TEXT;

-- Migrate existing data: url → original_url
UPDATE master_images 
SET original_url = url 
WHERE original_url IS NULL AND url IS NOT NULL;

-- Note: The 'url' column is kept for backward compatibility
-- It will be deprecated in favor of original_url

-- ============================================
-- Fix RLS Policies for Anonymous Access
-- ============================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admin can manage master_images" ON master_images;

-- Allow anonymous INSERT for master_images
CREATE POLICY "Allow anonymous insert for master_images" ON master_images
    FOR INSERT WITH CHECK (true);

-- Allow anonymous UPDATE for master_images
CREATE POLICY "Allow anonymous update for master_images" ON master_images
    FOR UPDATE USING (true);

-- Allow anonymous DELETE for master_images
CREATE POLICY "Allow anonymous delete for master_images" ON master_images
    FOR DELETE USING (true);
