#!/bin/bash
set -e

# Kill anything on port 5174
echo "→ Stopping existing server..."
lsof -ti :5174 | xargs kill -9 2>/dev/null || true
sleep 1

# Start dev server
echo "→ Starting dev server on http://localhost:5174"
npm run dev
