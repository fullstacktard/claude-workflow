# Claude Workflow Dashboard

A multi-page React web application providing OAuth account management, real-time monitoring, and routing analytics for Claude Code workflows.

## Overview

This dashboard provides three main interfaces:
- **Home Page** - OAuth account management and real-time log streaming
- **Analytics Page** - Visual insights into routing decisions and agent/skill usage
- **Monitor Page** - Real-time session monitoring and log streaming

## Features

### Home Page
- **Multi-Account OAuth Management**: View and manage multiple AI provider accounts
- **Live Log Feed**: Real-time log streaming via WebSocket across all projects
- **Project List**: Browse projects with 24-hour token usage stats
- **Account Usage Tracking**: Monitor API usage across all connected accounts
- **Responsive Grid Layout**: Optimized layout for desktop, tablet, and mobile

### Analytics Page (Routing Analytics)
- **Usage Distribution**: Pie chart showing agent vs skill usage breakdown
- **Top Agents/Skills**: Horizontal bar chart of the most used agents and skills
- **Decisions Over Time**: Line chart tracking routing decisions over time
- **Follow-Through Rate**: Gauge showing how often recommendations are followed
- **Sortable Log Table**: Detailed view of routing decisions with sortable columns
- **Filtering**: Filter by project, time range, decision type, and follow status

### Monitor Page
- **Session List**: View and select active Claude Code sessions
- **Real-Time Logs**: Stream logs for selected session
- **Session Stats**: Token usage and performance metrics

## Application Structure

### Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | HomePage | Landing page with account management |
| `/analytics` | App | Routing analytics dashboard |
| `/monitor` | MonitorScreen | Real-time session monitoring |

## Prerequisites

- Node.js >= 18.0.0
- Backend API running on port 3850 (see `src/lib/dashboard/server.ts`)

## Setup

```bash
# Navigate to frontend directory
cd src/lib/dashboard/frontend

# Install dependencies
npm install
```

## Development

```bash
# Start the development server (port 5173)
npm run dev

# Or from project root:
npm run dashboard:dev
```

The dev server proxies API requests to `http://localhost:3850`.

## Building

```bash
# Build for production
npm run build

# Or from project root:
npm run dashboard:build
```

Output is generated in `dist/`.

## Preview Production Build

```bash
npm run preview

# Or from project root:
npm run dashboard:preview
```

## API Endpoints Required

The dashboard expects these endpoints from the backend API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/logs` | GET | Query routing logs with filters |
| `/api/stats` | GET | Aggregated statistics |
| `/api/projects` | GET | List discovered projects |
| `/health` | GET | Health check |

### Query Parameters for `/api/logs`

- `project` - Filter by project name
- `timeRange` - `1h`, `24h`, `7d`, `30d`
- `type` - `agent` or `skill`
- `followed` - `true` or `false`
- `limit` - Max results (default 50, max 200)
- `offset` - Pagination offset

## Project Structure

```
src/
  components/
    AccountUsageWidget.tsx  # OAuth account usage display
    CcproxyStatusWidget.tsx # ccproxy health monitor
    DecisionsOverTime.tsx   # Line chart for time series
    Filters.tsx             # Sidebar filter controls
    FollowThroughGauge.tsx  # Semi-circular gauge
    LiveLogFeed.tsx         # Real-time log streaming widget
    LoadingSpinner.tsx      # Loading indicator
    LogStreamWidget.tsx     # Session-specific log stream
    LogTable.tsx            # Sortable log table
    Navigation.tsx          # Header navigation links
    ProjectListWidget.tsx   # Project list with token stats
    RecentActivityWidget.tsx # Recent API activity
    RoutingEfficiencyWidget.tsx # Routing metrics
    SessionStatsWidget.tsx  # Session statistics
    TopAgentsChart.tsx      # Horizontal bar chart
    UsageChart.tsx          # Pie chart
    index.ts                # Component exports
  hooks/
    useRoutingData.ts       # Data fetching hooks
    useWebSocket.ts         # WebSocket connection management
  pages/
    HomePage.tsx            # Landing page with account management
    MonitorScreen.tsx       # Real-time session monitoring
  styles/
    index.css               # Consolidated global styles
    pages/
      home-page.css         # HomePage-specific styles
  types/
    index.ts                # TypeScript interfaces
  App.tsx                   # Analytics dashboard (route)
  main.tsx                  # Entry point with routing
```

## Tech Stack

- **React 18** - UI framework
- **React Router DOM v6** - Client-side routing
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Recharts** - Charting library
- **WebSocket** - Real-time log streaming
- **CSS Grid & Flexbox** - Responsive layouts
- **CSS Variables** - Theming and responsive design

## Running with Backend

1. Start the backend API server:
   ```bash
   npm run dashboard:api
   ```

2. Start the frontend dev server:
   ```bash
   npm run dashboard:dev
   ```

3. Open http://localhost:5173 in your browser

## Customization

### Colors

Edit CSS variables in `src/styles/index.css`:

```css
:root {
  --color-primary: #0088fe;
  --color-secondary: #00c49f;
  --color-warning: #ffbb28;
  --color-danger: #ff8042;
}
```

### Adding New Charts

1. Create a new component in `src/components/`
2. Export it from `src/components/index.ts`
3. Import and use in `App.tsx`
4. Add corresponding styles to `index.css`
