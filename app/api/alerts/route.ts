import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeeTimeAlert {
  id: string
  courseName: string
  courseUrl?: string
  dates: string[]
  timeWindowStart: string
  timeWindowEnd: string
  players: number
  email: string
  frequency: string
  status: 'active' | 'paused'
  createdAt: string
}

interface Notification {
  id: string
  alertId: string
  courseName: string
  teeTimeDate: string
  teeTimeSlot: string
  availableSpots: number
  bookingLink: string
  sentAt: string
  emailSent: boolean
}

interface Settings {
  defaultEmail: string
  defaultFrequency: string
  emailEnabled: boolean
}

interface DataStore {
  alerts: TeeTimeAlert[]
  notifications: Notification[]
  settings: Settings
}

// ─── File-based storage ──────────────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), 'data', 'alerts.json')

function readData(): DataStore {
  try {
    const dir = path.dirname(DATA_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    if (!fs.existsSync(DATA_FILE)) {
      const defaults: DataStore = {
        alerts: [],
        notifications: [],
        settings: { defaultEmail: '', defaultFrequency: '15', emailEnabled: true },
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2))
      return defaults
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8')
    return JSON.parse(raw) as DataStore
  } catch {
    return {
      alerts: [],
      notifications: [],
      settings: { defaultEmail: '', defaultFrequency: '15', emailEnabled: true },
    }
  }
}

function writeData(data: DataStore): void {
  try {
    const dir = path.dirname(DATA_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('[alerts/route] Failed to write data:', err)
  }
}

// ─── GET: Read all data ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') || 'all'

    const data = readData()

    switch (action) {
      case 'all':
        return NextResponse.json({ success: true, ...data })

      case 'alerts':
        return NextResponse.json({ success: true, alerts: data.alerts })

      case 'notifications':
        return NextResponse.json({ success: true, notifications: data.notifications })

      case 'settings':
        return NextResponse.json({ success: true, settings: data.settings })

      case 'active-alerts':
        // Return only active alerts — useful for the scheduled agent
        return NextResponse.json({
          success: true,
          alerts: data.alerts.filter(a => a.status === 'active'),
        })

      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 }
    )
  }
}

// ─── POST: Create / Update ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    const data = readData()

    switch (action) {
      case 'save-alert': {
        const alert = body.alert as TeeTimeAlert
        if (!alert || !alert.id) {
          return NextResponse.json({ success: false, error: 'Alert data required' }, { status: 400 })
        }
        const idx = data.alerts.findIndex(a => a.id === alert.id)
        if (idx !== -1) {
          data.alerts[idx] = alert
        } else {
          data.alerts.push(alert)
        }
        writeData(data)
        return NextResponse.json({ success: true, alert })
      }

      case 'delete-alert': {
        const { alertId } = body
        if (!alertId) {
          return NextResponse.json({ success: false, error: 'alertId required' }, { status: 400 })
        }
        data.alerts = data.alerts.filter(a => a.id !== alertId)
        writeData(data)
        return NextResponse.json({ success: true })
      }

      case 'toggle-alert': {
        const { alertId: toggleId } = body
        if (!toggleId) {
          return NextResponse.json({ success: false, error: 'alertId required' }, { status: 400 })
        }
        const alert = data.alerts.find(a => a.id === toggleId)
        if (!alert) {
          return NextResponse.json({ success: false, error: 'Alert not found' }, { status: 404 })
        }
        alert.status = alert.status === 'active' ? 'paused' : 'active'
        writeData(data)
        return NextResponse.json({ success: true, alert })
      }

      case 'add-notifications': {
        const newNotifs = body.notifications as Notification[]
        if (!Array.isArray(newNotifs)) {
          return NextResponse.json({ success: false, error: 'notifications array required' }, { status: 400 })
        }
        data.notifications = [...newNotifs, ...data.notifications]
        // Keep only the latest 200 notifications
        if (data.notifications.length > 200) {
          data.notifications = data.notifications.slice(0, 200)
        }
        writeData(data)
        return NextResponse.json({ success: true, total: data.notifications.length })
      }

      case 'update-settings': {
        const settings = body.settings as Partial<Settings>
        if (!settings) {
          return NextResponse.json({ success: false, error: 'settings required' }, { status: 400 })
        }
        data.settings = { ...data.settings, ...settings }
        writeData(data)
        return NextResponse.json({ success: true, settings: data.settings })
      }

      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 }
    )
  }
}
