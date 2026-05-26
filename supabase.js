import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ouybwkjapejgpuuujwgy.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91eWJ3a2phcGVqZ3B1dXVqd2d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjQzMDYsImV4cCI6MjA3ODcwMDMwNn0.3JLJqAlW0oUCk3uprCz8j3dSSm95RG0dabXEKJbRPVo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
