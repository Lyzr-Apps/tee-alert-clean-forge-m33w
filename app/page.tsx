'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import fetchWrapper from '@/lib/fetchWrapper'
import { listSchedules, getScheduleLogs, pauseSchedule, resumeSchedule, triggerScheduleNow, cronToHuman } from '@/lib/scheduler'
import type { Schedule, ExecutionLog } from '@/lib/scheduler'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IoGolf, IoTime, IoMail, IoSettings, IoCalendar, IoAdd, IoPause, IoPlay, IoTrash, IoRefresh, IoCheckmark, IoClose, IoSearch, IoNotifications, IoFilter, IoPeople } from 'react-icons/io5'
import { FiClock, FiActivity } from 'react-icons/fi'
import { BiLinkExternal } from 'react-icons/bi'
import { MdDashboard, MdSchedule } from 'react-icons/md'

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

const TEE_TIME_CHECKER_ID = '6999248b317f68b98913d7dc'
const EMAIL_ALERT_ID = '699924a15d02b31774efd839'
const SCHEDULE_ID = '699924a0399dfadeac37dd32'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

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

interface TeeTimeMatch {
  date: string
  time: string
  available_spots: number
  price: string
  booking_link: string
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

type ScreenName = 'dashboard' | 'create' | 'notifications' | 'settings'

// ────────────────────────────────────────────────────────────────────────────
// ERROR BOUNDARY
// ────────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER
// ────────────────────────────────────────────────────────────────────────────

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    )
  )
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return (
            <h4 key={i} className="font-semibold text-sm mt-3 mb-1">
              {line.slice(4)}
            </h4>
          )
        if (line.startsWith('## '))
          return (
            <h3 key={i} className="font-semibold text-base mt-3 mb-1">
              {line.slice(3)}
            </h3>
          )
        if (line.startsWith('# '))
          return (
            <h2 key={i} className="font-bold text-lg mt-4 mb-2">
              {line.slice(2)}
            </h2>
          )
        if (line.startsWith('- ') || line.startsWith('* '))
          return (
            <li key={i} className="ml-4 list-disc text-sm">
              {formatInline(line.slice(2))}
            </li>
          )
        if (/^\d+\.\s/.test(line))
          return (
            <li key={i} className="ml-4 list-decimal text-sm">
              {formatInline(line.replace(/^\d+\.\s/, ''))}
            </li>
          )
        if (!line.trim()) return <div key={i} className="h-1" />
        return (
          <p key={i} className="text-sm">
            {formatInline(line)}
          </p>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TIME HELPERS
// ────────────────────────────────────────────────────────────────────────────

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let h = 5; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = h.toString().padStart(2, '0')
      const mm = m.toString().padStart(2, '0')
      slots.push(`${hh}:${mm}`)
    }
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

function formatTimeDisplay(time: string): string {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${mStr} ${ampm}`
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return dateStr
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// ────────────────────────────────────────────────────────────────────────────
// SAMPLE DATA
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_ALERTS: TeeTimeAlert[] = [
  {
    id: 'sample-1',
    courseName: 'Pebble Beach Golf Links',
    dates: ['2025-07-15', '2025-07-16', '2025-07-17'],
    timeWindowStart: '07:00',
    timeWindowEnd: '10:00',
    players: 4,
    email: 'golfer@example.com',
    frequency: '15',
    status: 'active',
    createdAt: '2025-07-10T08:00:00Z',
  },
  {
    id: 'sample-2',
    courseName: 'Augusta National Golf Club',
    dates: ['2025-08-01'],
    timeWindowStart: '08:00',
    timeWindowEnd: '11:00',
    players: 2,
    email: 'golfer@example.com',
    frequency: '30',
    status: 'active',
    createdAt: '2025-07-09T12:00:00Z',
  },
  {
    id: 'sample-3',
    courseName: 'St Andrews Old Course',
    dates: ['2025-07-20'],
    timeWindowStart: '06:00',
    timeWindowEnd: '09:00',
    players: 3,
    email: 'golfer@example.com',
    frequency: '60',
    status: 'paused',
    createdAt: '2025-07-05T14:30:00Z',
  },
]

const SAMPLE_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-1',
    alertId: 'sample-1',
    courseName: 'Pebble Beach Golf Links',
    teeTimeDate: '2025-07-15',
    teeTimeSlot: '07:30 AM',
    availableSpots: 4,
    bookingLink: 'https://www.pebblebeach.com/book',
    sentAt: '2025-07-12T06:15:00Z',
    emailSent: true,
  },
  {
    id: 'notif-2',
    alertId: 'sample-1',
    courseName: 'Pebble Beach Golf Links',
    teeTimeDate: '2025-07-16',
    teeTimeSlot: '08:00 AM',
    availableSpots: 3,
    bookingLink: 'https://www.pebblebeach.com/book',
    sentAt: '2025-07-12T06:30:00Z',
    emailSent: true,
  },
  {
    id: 'notif-3',
    alertId: 'sample-2',
    courseName: 'Augusta National Golf Club',
    teeTimeDate: '2025-08-01',
    teeTimeSlot: '09:15 AM',
    availableSpots: 2,
    bookingLink: 'https://www.augustanational.com/book',
    sentAt: '2025-07-11T10:00:00Z',
    emailSent: true,
  },
  {
    id: 'notif-4',
    alertId: 'sample-1',
    courseName: 'Pebble Beach Golf Links',
    teeTimeDate: '2025-07-17',
    teeTimeSlot: '07:45 AM',
    availableSpots: 4,
    bookingLink: 'https://www.pebblebeach.com/book',
    sentAt: '2025-07-10T07:00:00Z',
    emailSent: true,
  },
]

// ────────────────────────────────────────────────────────────────────────────
// GLASS CARD WRAPPER
// ────────────────────────────────────────────────────────────────────────────

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card/75 backdrop-blur-[16px] border border-white/[0.18] rounded-[0.875rem] shadow-sm ${className}`}>
      {children}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'paused' | 'expired' | string }) {
  const config: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    active: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500', label: 'Active' },
    paused: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500', label: 'Paused' },
    expired: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', label: 'Expired' },
  }
  const c = config[status] || config.expired
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// LOADING SPINNER
// ────────────────────────────────────────────────────────────────────────────

function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' }
  return (
    <svg className={`animate-spin ${sizeClasses[size]} text-primary`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ────────────────────────────────────────────────────────────────────────────

function AppSidebar({
  activeScreen,
  onNavigate,
  alertCount,
}: {
  activeScreen: ScreenName
  onNavigate: (screen: ScreenName) => void
  alertCount: number
}) {
  const navItems: { screen: ScreenName; icon: React.ReactNode; label: string; badge?: number }[] = [
    { screen: 'dashboard', icon: <MdDashboard className="h-5 w-5" />, label: 'Dashboard', badge: alertCount },
    { screen: 'create', icon: <IoAdd className="h-5 w-5" />, label: 'Create Alert' },
    { screen: 'notifications', icon: <IoNotifications className="h-5 w-5" />, label: 'History' },
    { screen: 'settings', icon: <IoSettings className="h-5 w-5" />, label: 'Settings' },
  ]

  return (
    <div className="w-64 min-h-screen bg-card/60 backdrop-blur-[16px] border-r border-border flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[0.875rem] bg-primary flex items-center justify-center">
          <IoGolf className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground leading-tight">Tee Time</h1>
          <p className="text-xs text-muted-foreground font-medium">Alerts</p>
        </div>
      </div>

      <Separator className="mx-4" />

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.screen}
            onClick={() => onNavigate(item.screen)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.875rem] text-sm font-medium transition-all duration-200 ${activeScreen === item.screen ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${activeScreen === item.screen ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-4">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <FiActivity className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">Agents</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground truncate">Tee Time Checker</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground truncate">Email Alert</span>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD SCREEN
// ────────────────────────────────────────────────────────────────────────────

function DashboardScreen({
  alerts,
  notifications,
  onNavigateCreate,
  onCheckNow,
  onToggleAlert,
  onDeleteAlert,
  onEditAlert,
  checkingAlertId,
  activeAgentId,
  statusMessages,
}: {
  alerts: TeeTimeAlert[]
  notifications: Notification[]
  onNavigateCreate: () => void
  onCheckNow: (alert: TeeTimeAlert) => void
  onToggleAlert: (id: string) => void
  onDeleteAlert: (id: string) => void
  onEditAlert: (alert: TeeTimeAlert) => void
  checkingAlertId: string | null
  activeAgentId: string | null
  statusMessages: Record<string, { type: 'success' | 'error' | 'info'; text: string }>
}) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Monitor your tee time alerts and recent notifications</p>
        </div>
        <Button onClick={onNavigateCreate} className="gap-2 rounded-[0.875rem]">
          <IoAdd className="h-4 w-4" />
          Create Alert
        </Button>
      </div>

      {/* Active agent indicator */}
      {activeAgentId && (
        <div className="flex items-center gap-2 text-sm text-primary bg-primary/5 px-4 py-2 rounded-[0.875rem] border border-primary/10">
          <Spinner size="sm" />
          <span className="font-medium">
            {activeAgentId === TEE_TIME_CHECKER_ID ? 'Tee Time Checker' : 'Email Alert'} agent is working...
          </span>
        </div>
      )}

      {alerts.length === 0 ? (
        /* Empty state */
        <GlassCard className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <IoGolf className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Alerts Yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Create your first tee time alert to start monitoring course availability. We will check for openings and notify you instantly.
          </p>
          <Button onClick={onNavigateCreate} className="gap-2 rounded-[0.875rem]">
            <IoAdd className="h-4 w-4" />
            Create Your First Alert
          </Button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Alert cards — left 3 cols */}
          <div className="lg:col-span-3 space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Active Alerts ({alerts.length})</h3>
            {alerts.map((alert) => (
              <GlassCard key={alert.id} className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <IoGolf className="h-4 w-4 text-primary flex-shrink-0" />
                      <h4 className="text-base font-semibold text-foreground truncate">{alert.courseName}</h4>
                    </div>
                    <StatusBadge status={alert.status} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <IoTime className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{formatTimeDisplay(alert.timeWindowStart)} - {formatTimeDisplay(alert.timeWindowEnd)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <IoPeople className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{alert.players} {alert.players === 1 ? 'player' : 'players'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <IoCalendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{Array.isArray(alert.dates) ? alert.dates.length : 0} {(Array.isArray(alert.dates) ? alert.dates.length : 0) === 1 ? 'date' : 'dates'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FiClock className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Every {alert.frequency} min</span>
                  </div>
                </div>

                {/* Status message for this alert */}
                {statusMessages[alert.id] && (
                  <div className={`text-xs px-3 py-2 rounded-lg mb-3 ${statusMessages[alert.id].type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : statusMessages[alert.id].type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                    {statusMessages[alert.id].text}
                  </div>
                )}

                <Separator className="mb-3" />

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onCheckNow(alert)}
                    disabled={checkingAlertId === alert.id}
                    className="gap-1.5 rounded-[0.875rem] text-xs"
                  >
                    {checkingAlertId === alert.id ? (
                      <><Spinner size="sm" /> Checking...</>
                    ) : (
                      <><IoSearch className="h-3.5 w-3.5" /> Check Now</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleAlert(alert.id)}
                    className="gap-1.5 rounded-[0.875rem] text-xs"
                  >
                    {alert.status === 'active' ? (
                      <><IoPause className="h-3.5 w-3.5" /> Pause</>
                    ) : (
                      <><IoPlay className="h-3.5 w-3.5" /> Resume</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEditAlert(alert)}
                    className="gap-1.5 rounded-[0.875rem] text-xs"
                  >
                    <IoSettings className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDeleteAlert(alert.id)}
                    className="gap-1.5 rounded-[0.875rem] text-xs text-destructive hover:text-destructive"
                  >
                    <IoTrash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Recent notifications — right 2 cols */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent Notifications</h3>
            {notifications.length === 0 ? (
              <GlassCard className="p-6 text-center">
                <IoNotifications className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </GlassCard>
            ) : (
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3 pr-2">
                  {notifications.slice(0, 10).map((notif) => (
                    <GlassCard key={notif.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <IoMail className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{notif.courseName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {notif.teeTimeDate} at {notif.teeTimeSlot}
                          </p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <IoPeople className="h-3 w-3" />
                              {notif.availableSpots} spots
                            </span>
                            {notif.bookingLink && (
                              <a
                                href={notif.bookingLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                              >
                                Book Now <BiLinkExternal className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground/70 mt-1.5">
                            {notif.emailSent ? 'Email sent' : 'Not sent'} - {formatDateTime(notif.sentAt)}
                          </p>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CREATE / EDIT ALERT SCREEN
// ────────────────────────────────────────────────────────────────────────────

function CreateAlertScreen({
  editingAlert,
  onSave,
  onCancel,
  isSaving,
  statusMessage,
}: {
  editingAlert: TeeTimeAlert | null
  onSave: (alert: TeeTimeAlert) => void
  onCancel: () => void
  isSaving: boolean
  statusMessage: { type: 'success' | 'error' | 'info'; text: string } | null
}) {
  const [formData, setFormData] = useState({
    courseName: editingAlert?.courseName ?? '',
    date: Array.isArray(editingAlert?.dates) && editingAlert.dates.length > 0 ? editingAlert.dates[0] : '',
    timeWindowStart: editingAlert?.timeWindowStart ?? '07:00',
    timeWindowEnd: editingAlert?.timeWindowEnd ?? '10:00',
    players: editingAlert?.players ?? 4,
    email: editingAlert?.email ?? '',
    frequency: editingAlert?.frequency ?? '15',
  })

  const handleSave = () => {
    if (!formData.courseName || !formData.date || !formData.email) return
    const alert: TeeTimeAlert = {
      id: editingAlert?.id ?? generateId(),
      courseName: formData.courseName,
      dates: [formData.date],
      timeWindowStart: formData.timeWindowStart,
      timeWindowEnd: formData.timeWindowEnd,
      players: formData.players,
      email: formData.email,
      frequency: formData.frequency,
      status: editingAlert?.status ?? 'active',
      createdAt: editingAlert?.createdAt ?? new Date().toISOString(),
    }
    onSave(alert)
  }

  const isValid = formData.courseName && formData.date && formData.email

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{editingAlert ? 'Edit Alert' : 'Create Alert'}</h2>
        <p className="text-sm text-muted-foreground mt-1">Set up monitoring for your preferred tee times</p>
      </div>

      <GlassCard className="p-6 space-y-6">
        {/* Course Name */}
        <div className="space-y-2">
          <Label htmlFor="course-name" className="text-sm font-medium">Course Name *</Label>
          <Input
            id="course-name"
            placeholder="e.g. Pebble Beach Golf Links"
            value={formData.courseName}
            onChange={(e) => setFormData(prev => ({ ...prev, courseName: e.target.value }))}
            className="rounded-[0.875rem]"
          />
        </div>

        {/* Date */}
        <div className="space-y-2">
          <Label htmlFor="date" className="text-sm font-medium">Date *</Label>
          <Input
            id="date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
            className="rounded-[0.875rem]"
          />
        </div>

        {/* Time Window */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Start Time *</Label>
            <Select
              value={formData.timeWindowStart}
              onValueChange={(val) => setFormData(prev => ({ ...prev, timeWindowStart: val }))}
            >
              <SelectTrigger className="rounded-[0.875rem]">
                <SelectValue placeholder="Start time" />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.map((t) => (
                  <SelectItem key={`start-${t}`} value={t}>{formatTimeDisplay(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">End Time *</Label>
            <Select
              value={formData.timeWindowEnd}
              onValueChange={(val) => setFormData(prev => ({ ...prev, timeWindowEnd: val }))}
            >
              <SelectTrigger className="rounded-[0.875rem]">
                <SelectValue placeholder="End time" />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.map((t) => (
                  <SelectItem key={`end-${t}`} value={t}>{formatTimeDisplay(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Number of Players */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Number of Players</Label>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-[0.875rem] h-9 w-9 p-0"
              onClick={() => setFormData(prev => ({ ...prev, players: Math.max(1, prev.players - 1) }))}
              disabled={formData.players <= 1}
            >
              -
            </Button>
            <span className="text-lg font-semibold w-8 text-center">{formData.players}</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[0.875rem] h-9 w-9 p-0"
              onClick={() => setFormData(prev => ({ ...prev, players: Math.min(4, prev.players + 1) }))}
              disabled={formData.players >= 4}
            >
              +
            </Button>
            <span className="text-sm text-muted-foreground ml-2">{formData.players === 1 ? 'player' : 'players'}</span>
          </div>
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Notification Email *</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            className="rounded-[0.875rem]"
          />
        </div>

        {/* Frequency */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Check Frequency</Label>
          <Select
            value={formData.frequency}
            onValueChange={(val) => setFormData(prev => ({ ...prev, frequency: val }))}
          >
            <SelectTrigger className="rounded-[0.875rem]">
              <SelectValue placeholder="Frequency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Every 15 minutes</SelectItem>
              <SelectItem value="30">Every 30 minutes</SelectItem>
              <SelectItem value="60">Every hour</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Status message */}
        {statusMessage && (
          <div className={`text-sm px-4 py-3 rounded-[0.875rem] ${statusMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : statusMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {statusMessage.text}
          </div>
        )}

        <Separator />

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} className="rounded-[0.875rem]">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isValid || isSaving}
            className="gap-2 rounded-[0.875rem]"
          >
            {isSaving ? (
              <><Spinner size="sm" /> Saving...</>
            ) : (
              <><IoCheckmark className="h-4 w-4" /> {editingAlert ? 'Update Alert' : 'Save Alert'}</>
            )}
          </Button>
        </div>
      </GlassCard>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATION HISTORY SCREEN
// ────────────────────────────────────────────────────────────────────────────

function NotificationHistoryScreen({ notifications }: { notifications: Notification[] }) {
  const [filterCourse, setFilterCourse] = useState('')

  const filtered = notifications.filter((n) => {
    if (filterCourse && !n.courseName.toLowerCase().includes(filterCourse.toLowerCase())) return false
    return true
  })

  const uniqueCourses = Array.from(new Set(notifications.map((n) => n.courseName)))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Notification History</h2>
        <p className="text-sm text-muted-foreground mt-1">
          All alerts sent for matching tee times ({notifications.length} total)
        </p>
      </div>

      {/* Filter Bar */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IoFilter className="h-4 w-4" />
            <span className="font-medium">Filter</span>
          </div>
          <Select value={filterCourse} onValueChange={setFilterCourse}>
            <SelectTrigger className="w-[200px] rounded-[0.875rem]">
              <SelectValue placeholder="All courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {uniqueCourses.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filterCourse && filterCourse !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setFilterCourse('')} className="gap-1 text-xs">
              <IoClose className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <IoNotifications className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Notifications Yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            When we find matching tee times, notifications will appear here with all the details.
          </p>
        </GlassCard>
      ) : (
        <ScrollArea className="max-h-[calc(100vh-280px)]">
          <div className="space-y-3 pr-2">
            {filtered.map((notif) => (
              <GlassCard key={notif.id} className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {notif.emailSent ? (
                      <IoCheckmark className="h-5 w-5 text-primary" />
                    ) : (
                      <IoClose className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-semibold text-foreground">{notif.courseName}</h4>
                      <Badge variant={notif.emailSent ? 'default' : 'secondary'} className="text-xs">
                        {notif.emailSent ? 'Sent' : 'Pending'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Date</p>
                        <p className="text-sm font-medium">{formatDate(notif.teeTimeDate)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Time</p>
                        <p className="text-sm font-medium">{notif.teeTimeSlot}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Spots</p>
                        <p className="text-sm font-medium">{notif.availableSpots}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Sent At</p>
                        <p className="text-sm font-medium">{formatDateTime(notif.sentAt)}</p>
                      </div>
                    </div>
                    {notif.bookingLink && (
                      <a
                        href={notif.bookingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 text-sm text-primary font-medium hover:underline"
                      >
                        <BiLinkExternal className="h-3.5 w-3.5" />
                        Book Now
                      </a>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS SCREEN
// ────────────────────────────────────────────────────────────────────────────

function SettingsScreen({
  defaultEmail,
  setDefaultEmail,
  defaultFrequency,
  setDefaultFrequency,
  emailEnabled,
  setEmailEnabled,
  scheduleData,
  scheduleLogs,
  scheduleLoading,
  scheduleError,
  onPauseResume,
  onTriggerNow,
  onRefreshSchedule,
  scheduleActionLoading,
  scheduleStatusMessage,
}: {
  defaultEmail: string
  setDefaultEmail: (v: string) => void
  defaultFrequency: string
  setDefaultFrequency: (v: string) => void
  emailEnabled: boolean
  setEmailEnabled: (v: boolean) => void
  scheduleData: Schedule | null
  scheduleLogs: ExecutionLog[]
  scheduleLoading: boolean
  scheduleError: string | null
  onPauseResume: () => void
  onTriggerNow: () => void
  onRefreshSchedule: () => void
  scheduleActionLoading: boolean
  scheduleStatusMessage: { type: 'success' | 'error' | 'info'; text: string } | null
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure your default preferences and manage schedules</p>
      </div>

      {/* Preferences */}
      <GlassCard className="p-6 space-y-6">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <IoSettings className="h-4 w-4 text-primary" />
          Preferences
        </h3>

        <div className="space-y-2">
          <Label htmlFor="default-email" className="text-sm font-medium">Default Email Address</Label>
          <Input
            id="default-email"
            type="email"
            placeholder="your@email.com"
            value={defaultEmail}
            onChange={(e) => setDefaultEmail(e.target.value)}
            className="rounded-[0.875rem] max-w-md"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Default Check Frequency</Label>
          <Select value={defaultFrequency} onValueChange={setDefaultFrequency}>
            <SelectTrigger className="rounded-[0.875rem] max-w-md">
              <SelectValue placeholder="Frequency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Every 15 minutes</SelectItem>
              <SelectItem value="30">Every 30 minutes</SelectItem>
              <SelectItem value="60">Every hour</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label className="text-sm font-medium">Email Notifications</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Receive email alerts when matches are found</p>
          </div>
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
        </div>
      </GlassCard>

      {/* Schedule Management */}
      <GlassCard className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <MdSchedule className="h-4 w-4 text-primary" />
            Schedule Management
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefreshSchedule}
            disabled={scheduleLoading}
            className="gap-1 text-xs"
          >
            <IoRefresh className={`h-3.5 w-3.5 ${scheduleLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {scheduleError && (
          <div className="text-sm px-4 py-3 rounded-[0.875rem] bg-red-50 text-red-700 border border-red-200">
            {scheduleError}
          </div>
        )}

        {scheduleStatusMessage && (
          <div className={`text-sm px-4 py-3 rounded-[0.875rem] ${scheduleStatusMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : scheduleStatusMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {scheduleStatusMessage.text}
          </div>
        )}

        {scheduleLoading && !scheduleData ? (
          <div className="flex items-center gap-3 py-6 justify-center">
            <Spinner />
            <span className="text-sm text-muted-foreground">Loading schedule...</span>
          </div>
        ) : scheduleData ? (
          <div className="space-y-4">
            {/* Schedule info grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Status</p>
                <StatusBadge status={scheduleData.is_active ? 'active' : 'paused'} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Frequency</p>
                <p className="text-sm font-medium">{scheduleData.cron_expression ? cronToHuman(scheduleData.cron_expression) : 'Unknown'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Timezone</p>
                <p className="text-sm font-medium">{scheduleData.timezone || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Next Run</p>
                <p className="text-sm font-medium">{scheduleData.next_run_time ? formatDateTime(scheduleData.next_run_time) : 'N/A'}</p>
              </div>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button
                variant={scheduleData.is_active ? 'outline' : 'default'}
                size="sm"
                onClick={onPauseResume}
                disabled={scheduleActionLoading}
                className="gap-1.5 rounded-[0.875rem]"
              >
                {scheduleActionLoading ? (
                  <Spinner size="sm" />
                ) : scheduleData.is_active ? (
                  <IoPause className="h-3.5 w-3.5" />
                ) : (
                  <IoPlay className="h-3.5 w-3.5" />
                )}
                {scheduleData.is_active ? 'Pause Schedule' : 'Resume Schedule'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onTriggerNow}
                disabled={scheduleActionLoading}
                className="gap-1.5 rounded-[0.875rem]"
              >
                <IoRefresh className="h-3.5 w-3.5" />
                Run Now
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No schedule data available. Click Refresh to load.
          </div>
        )}

        {/* Execution History */}
        {Array.isArray(scheduleLogs) && scheduleLogs.length > 0 && (
          <div className="space-y-3">
            <Separator />
            <h4 className="text-sm font-semibold text-foreground">Recent Execution History</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Timestamp</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Status</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Attempt</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleLogs.slice(0, 10).map((log) => (
                    <tr key={log.id} className="border-b border-border/50">
                      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.executed_at)}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${log.success ? 'text-green-700' : 'text-red-600'}`}>
                          {log.success ? <IoCheckmark className="h-3 w-3" /> : <IoClose className="h-3 w-3" />}
                          {log.success ? 'Success' : 'Failed'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {log.attempt}/{log.max_attempts}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground truncate max-w-[200px]">
                        {log.error_message || 'Completed successfully'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────

export default function Page() {
  // ── Navigation ──
  const [activeScreen, setActiveScreen] = useState<ScreenName>('dashboard')

  // ── Sample data toggle ──
  const [sampleMode, setSampleMode] = useState(false)

  // ── Alerts & Notifications (loaded from server) ──
  const [alerts, setAlerts] = useState<TeeTimeAlert[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [editingAlert, setEditingAlert] = useState<TeeTimeAlert | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)

  // ── Settings (loaded from server) ──
  const [defaultEmail, setDefaultEmail] = useState('')
  const [defaultFrequency, setDefaultFrequency] = useState('15')
  const [emailEnabled, setEmailEnabled] = useState(true)

  // ── Server-side persistence helpers ──
  const settingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadAllData = useCallback(async () => {
    try {
      const res = await fetchWrapper('/api/alerts?action=all')
      if (res) {
        const data = await res.json()
        if (data.success) {
          setAlerts(Array.isArray(data.alerts) ? data.alerts : [])
          setNotifications(Array.isArray(data.notifications) ? data.notifications : [])
          if (data.settings) {
            setDefaultEmail(data.settings.defaultEmail || '')
            setDefaultFrequency(data.settings.defaultFrequency || '15')
            setEmailEnabled(data.settings.emailEnabled !== false)
          }
        }
      }
    } catch (err) {
      console.error('[loadAllData] Failed:', err)
    } finally {
      setDataLoaded(true)
    }
  }, [])

  // Load data from server on mount
  useEffect(() => {
    loadAllData()
  }, [loadAllData])

  const saveAlertToServer = useCallback(async (alert: TeeTimeAlert) => {
    try {
      await fetchWrapper('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-alert', alert }),
      })
    } catch (err) {
      console.error('[saveAlertToServer] Failed:', err)
    }
  }, [])

  const deleteAlertFromServer = useCallback(async (alertId: string) => {
    try {
      await fetchWrapper('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-alert', alertId }),
      })
    } catch (err) {
      console.error('[deleteAlertFromServer] Failed:', err)
    }
  }, [])

  const toggleAlertOnServer = useCallback(async (alertId: string) => {
    try {
      await fetchWrapper('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-alert', alertId }),
      })
    } catch (err) {
      console.error('[toggleAlertOnServer] Failed:', err)
    }
  }, [])

  const saveNotificationsToServer = useCallback(async (newNotifs: Notification[]) => {
    try {
      await fetchWrapper('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-notifications', notifications: newNotifs }),
      })
    } catch (err) {
      console.error('[saveNotificationsToServer] Failed:', err)
    }
  }, [])

  const saveSettingsToServer = useCallback(async (settings: { defaultEmail: string; defaultFrequency: string; emailEnabled: boolean }) => {
    try {
      await fetchWrapper('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-settings', settings }),
      })
    } catch (err) {
      console.error('[saveSettingsToServer] Failed:', err)
    }
  }, [])

  // Debounced settings sync — save after 800ms of no changes
  useEffect(() => {
    if (!dataLoaded) return
    if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
    settingsDebounceRef.current = setTimeout(() => {
      saveSettingsToServer({ defaultEmail, defaultFrequency, emailEnabled })
    }, 800)
    return () => {
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
    }
  }, [defaultEmail, defaultFrequency, emailEnabled, dataLoaded, saveSettingsToServer])

  // ── Agent states ──
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [checkingAlertId, setCheckingAlertId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessages, setStatusMessages] = useState<Record<string, { type: 'success' | 'error' | 'info'; text: string }>>({})
  const [createStatusMessage, setCreateStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // ── Schedule state ──
  const [scheduleData, setScheduleData] = useState<Schedule | null>(null)
  const [scheduleLogs, setScheduleLogs] = useState<ExecutionLog[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleActionLoading, setScheduleActionLoading] = useState(false)
  const [scheduleStatusMessage, setScheduleStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // ── Data source (sample or real) ──
  const displayAlerts = sampleMode ? SAMPLE_ALERTS : alerts
  const displayNotifications = sampleMode ? SAMPLE_NOTIFICATIONS : notifications

  // ── Load schedule data ──
  const loadScheduleData = useCallback(async () => {
    setScheduleLoading(true)
    setScheduleError(null)
    try {
      const result = await listSchedules()
      if (result.success && Array.isArray(result.schedules)) {
        const found = result.schedules.find((s) => s.id === SCHEDULE_ID)
        if (found) {
          setScheduleData(found)
        } else if (result.schedules.length > 0) {
          setScheduleData(result.schedules[0])
        }
      } else {
        setScheduleError(result.error || 'Failed to load schedules')
      }

      const logsResult = await getScheduleLogs(SCHEDULE_ID, { limit: 10 })
      if (logsResult.success && Array.isArray(logsResult.executions)) {
        setScheduleLogs(logsResult.executions)
      }
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Failed to load schedule data')
    } finally {
      setScheduleLoading(false)
    }
  }, [])

  useEffect(() => {
    loadScheduleData()
  }, [loadScheduleData])

  // ── Handlers ──

  // Helper to extract tee time data from various response shapes
  const extractTeeTimeData = useCallback((result: any) => {
    // Try multiple paths to find the data
    const paths = [
      result?.response?.result,
      result?.response,
      result?.result,
      result,
    ]
    for (const data of paths) {
      if (data && typeof data === 'object') {
        const teeTimes = Array.isArray(data?.matching_tee_times) ? data.matching_tee_times : []
        if (teeTimes.length > 0 || data?.matches_found === true || data?.total_matches > 0) {
          return { data, teeTimes, found: true }
        }
        // Also check if matches_found is explicitly false but there are still tee times
        if (teeTimes.length > 0) {
          return { data, teeTimes, found: true }
        }
      }
    }
    // Return the best data object we found even if no matches
    const bestData = paths.find(d => d && typeof d === 'object' && 'course_name' in d) || paths[0]
    return { data: bestData, teeTimes: [], found: false }
  }, [])

  // Format date for better search queries
  const formatDateForSearch = useCallback((dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00')
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    } catch {
      return dateStr
    }
  }, [])

  const handleCheckNow = useCallback(async (alert: TeeTimeAlert) => {
    setCheckingAlertId(alert.id)
    setActiveAgentId(TEE_TIME_CHECKER_ID)
    setStatusMessages(prev => ({ ...prev, [alert.id]: { type: 'info', text: 'Searching GolfNow and other platforms for available tee times...' } }))

    try {
      const datesFormatted = Array.isArray(alert.dates) ? alert.dates.map(d => formatDateForSearch(d)) : []
      const datesStr = datesFormatted.join(', ')
      const rawDatesStr = Array.isArray(alert.dates) ? alert.dates.join(', ') : ''

      const checkMessage = `Search the web RIGHT NOW for available tee times. This is a real search request.

SEARCH FOR: "${alert.courseName}" tee times on GolfNow.com
DATES TO CHECK: ${datesStr} (${rawDatesStr})
PREFERRED TIME WINDOW: ${formatTimeDisplay(alert.timeWindowStart)} to ${formatTimeDisplay(alert.timeWindowEnd)}
NUMBER OF PLAYERS: ${alert.players}

INSTRUCTIONS:
1. Search GolfNow.com for "${alert.courseName}" tee times on ${datesStr}
2. Also search for "${alert.courseName} tee times ${rawDatesStr}"
3. List EVERY available tee time you find with the exact time, price, and booking URL
4. Set matches_found to true if you find ANY tee times at all
5. Include ALL tee times, not just those in the preferred window
6. Use real GolfNow booking URLs
7. If price is visible, include it. Otherwise use "See GolfNow"

Return the results as JSON with the matching_tee_times array populated.`

      const result = await callAIAgent(checkMessage, TEE_TIME_CHECKER_ID)

      // Debug: log raw response
      console.log('[TeeTimeChecker] Raw result:', JSON.stringify(result, null, 2))

      if (result.success) {
        const { data, teeTimes, found } = extractTeeTimeData(result)
        console.log('[TeeTimeChecker] Extracted:', { found, teeTimesCount: teeTimes.length, data })

        if (found && teeTimes.length > 0) {
          const totalMatches = teeTimes.length

          setStatusMessages(prev => ({
            ...prev,
            [alert.id]: {
              type: 'success',
              text: `Found ${totalMatches} available tee time${totalMatches !== 1 ? 's' : ''}! ${emailEnabled ? 'Sending email alert...' : ''}`,
            },
          }))

          // Send email for each match if email is enabled
          if (emailEnabled) {
            setActiveAgentId(EMAIL_ALERT_ID)
            const firstMatch = teeTimes[0]

            const emailMessage = `Send a tee time alert email with the following details:
Recipient Email: ${alert.email}
Email Subject: Tee Time Available - ${alert.courseName} on ${firstMatch?.date ?? rawDatesStr}
Course Name: ${alert.courseName}
Tee Time Date: ${firstMatch?.date ?? rawDatesStr}
Tee Time Slot: ${firstMatch?.time ?? 'Available'}
Available Spots: ${firstMatch?.available_spots ?? alert.players}
Price: ${firstMatch?.price ?? 'See booking site'}
Booking Link: ${firstMatch?.booking_link ?? 'https://www.golfnow.com'}

Additional tee times found: ${teeTimes.slice(1, 5).map((tt: TeeTimeMatch) => `${tt.time} ($${tt.price})`).join(', ') || 'None'}

Please compose a professional email with all these details and a prominent booking link.`

            const emailResult = await callAIAgent(emailMessage, EMAIL_ALERT_ID)

            // Add notifications for found tee times
            const newNotifications: Notification[] = teeTimes.map((tt: TeeTimeMatch) => ({
              id: generateId(),
              alertId: alert.id,
              courseName: data?.course_name ?? alert.courseName,
              teeTimeDate: tt?.date ?? '',
              teeTimeSlot: tt?.time ?? '',
              availableSpots: tt?.available_spots ?? 0,
              bookingLink: tt?.booking_link ?? '',
              sentAt: new Date().toISOString(),
              emailSent: emailResult?.success ?? false,
            }))

            setNotifications(prev => [...newNotifications, ...prev])
            saveNotificationsToServer(newNotifications)

            setStatusMessages(prev => ({
              ...prev,
              [alert.id]: {
                type: 'success',
                text: emailResult?.success
                  ? `${totalMatches} tee time${totalMatches !== 1 ? 's' : ''} found and email alert sent to ${alert.email}!`
                  : `${totalMatches} tee time${totalMatches !== 1 ? 's' : ''} found. Email delivery: ${emailResult?.error ?? 'check inbox'}`,
              },
            }))
          } else {
            // Add notifications without email
            const newNotifications: Notification[] = teeTimes.map((tt: TeeTimeMatch) => ({
              id: generateId(),
              alertId: alert.id,
              courseName: data?.course_name ?? alert.courseName,
              teeTimeDate: tt?.date ?? '',
              teeTimeSlot: tt?.time ?? '',
              availableSpots: tt?.available_spots ?? 0,
              bookingLink: tt?.booking_link ?? '',
              sentAt: new Date().toISOString(),
              emailSent: false,
            }))
            setNotifications(prev => [...newNotifications, ...prev])
            saveNotificationsToServer(newNotifications)

            setStatusMessages(prev => ({
              ...prev,
              [alert.id]: {
                type: 'success',
                text: `${totalMatches} tee time${totalMatches !== 1 ? 's' : ''} found! Email notifications are disabled in Settings.`,
              },
            }))
          }
        } else {
          // No matches - show debug info about what was returned
          const responsePreview = data ? JSON.stringify(data).substring(0, 200) : 'No data'
          const rawMsg = result?.response?.message || result?.raw_response || ''
          const debugHint = rawMsg ? ` Agent message: ${String(rawMsg).substring(0, 150)}` : ''

          setStatusMessages(prev => ({
            ...prev,
            [alert.id]: {
              type: 'info',
              text: `No tee times found for ${data?.course_name ?? alert.courseName} on ${rawDatesStr}. The agent searched but found no availability. Try a different date or broaden the time window.${debugHint}`,
            },
          }))
        }
      } else {
        setStatusMessages(prev => ({
          ...prev,
          [alert.id]: { type: 'error', text: `Agent error: ${result?.error ?? 'Failed to check tee times. Please try again.'}` },
        }))
      }
    } catch (err) {
      setStatusMessages(prev => ({
        ...prev,
        [alert.id]: { type: 'error', text: err instanceof Error ? err.message : 'An error occurred while checking tee times.' },
      }))
    } finally {
      setCheckingAlertId(null)
      setActiveAgentId(null)
    }
  }, [emailEnabled, extractTeeTimeData, formatDateForSearch])

  const handleSaveAlert = useCallback(async (alert: TeeTimeAlert) => {
    setIsSaving(true)
    setCreateStatusMessage({ type: 'info', text: 'Saving alert and searching for available tee times...' })
    setActiveAgentId(TEE_TIME_CHECKER_ID)

    try {
      const datesFormatted = Array.isArray(alert.dates) ? alert.dates.map(d => formatDateForSearch(d)) : []
      const datesStr = datesFormatted.join(', ')
      const rawDatesStr = Array.isArray(alert.dates) ? alert.dates.join(', ') : ''

      const checkMessage = `Search the web RIGHT NOW for available tee times. This is a real search request.

SEARCH FOR: "${alert.courseName}" tee times on GolfNow.com
DATES TO CHECK: ${datesStr} (${rawDatesStr})
PREFERRED TIME WINDOW: ${formatTimeDisplay(alert.timeWindowStart)} to ${formatTimeDisplay(alert.timeWindowEnd)}
NUMBER OF PLAYERS: ${alert.players}

INSTRUCTIONS:
1. Search GolfNow.com for "${alert.courseName}" tee times on ${datesStr}
2. Also search for "${alert.courseName} tee times ${rawDatesStr}"
3. List EVERY available tee time you find with the exact time, price, and booking URL
4. Set matches_found to true if you find ANY tee times at all
5. Include ALL tee times, not just those in the preferred window
6. Use real GolfNow booking URLs

Return the results as JSON with the matching_tee_times array populated.`

      const result = await callAIAgent(checkMessage, TEE_TIME_CHECKER_ID)

      // Save alert to state AND server regardless of check result
      setAlerts(prev => {
        const existing = prev.findIndex(a => a.id === alert.id)
        if (existing !== -1) {
          const updated = [...prev]
          updated[existing] = alert
          return updated
        }
        return [...prev, alert]
      })
      await saveAlertToServer(alert)

      if (result.success) {
        const { teeTimes, found } = extractTeeTimeData(result)
        const totalMatches = teeTimes.length
        setCreateStatusMessage({
          type: 'success',
          text: `Alert saved! ${found && totalMatches > 0 ? `Found ${totalMatches} available tee time${totalMatches !== 1 ? 's' : ''} - check Dashboard.` : 'Monitoring started. We will check periodically for openings.'}`,
        })
      } else {
        setCreateStatusMessage({ type: 'success', text: 'Alert saved! We will start checking for available tee times.' })
      }

      // Navigate to dashboard after a moment
      setTimeout(() => {
        setActiveScreen('dashboard')
        setEditingAlert(null)
        setCreateStatusMessage(null)
      }, 2500)
    } catch (err) {
      // Still save the alert even if check failed
      setAlerts(prev => {
        const existing = prev.findIndex(a => a.id === alert.id)
        if (existing !== -1) {
          const updated = [...prev]
          updated[existing] = alert
          return updated
        }
        return [...prev, alert]
      })
      await saveAlertToServer(alert)
      setCreateStatusMessage({ type: 'info', text: 'Alert saved! Initial check encountered an issue, but we will keep monitoring.' })
      setTimeout(() => {
        setActiveScreen('dashboard')
        setEditingAlert(null)
        setCreateStatusMessage(null)
      }, 2500)
    } finally {
      setIsSaving(false)
      setActiveAgentId(null)
    }
  }, [saveAlertToServer, extractTeeTimeData, formatDateForSearch])

  const handleToggleAlert = useCallback((id: string) => {
    setAlerts(prev =>
      prev.map(a =>
        a.id === id ? { ...a, status: a.status === 'active' ? 'paused' as const : 'active' as const } : a
      )
    )
    toggleAlertOnServer(id)
  }, [toggleAlertOnServer])

  const handleDeleteAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
    setStatusMessages(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    deleteAlertFromServer(id)
  }, [deleteAlertFromServer])

  const handleEditAlert = useCallback((alert: TeeTimeAlert) => {
    setEditingAlert(alert)
    setActiveScreen('create')
  }, [])

  const handlePauseResume = useCallback(async () => {
    if (!scheduleData) return
    setScheduleActionLoading(true)
    setScheduleStatusMessage(null)
    try {
      if (scheduleData.is_active) {
        const res = await pauseSchedule(scheduleData.id)
        if (res.success) {
          setScheduleStatusMessage({ type: 'success', text: 'Schedule paused successfully.' })
        } else {
          setScheduleStatusMessage({ type: 'error', text: res.error ?? 'Failed to pause schedule.' })
        }
      } else {
        const res = await resumeSchedule(scheduleData.id)
        if (res.success) {
          setScheduleStatusMessage({ type: 'success', text: 'Schedule resumed successfully.' })
        } else {
          setScheduleStatusMessage({ type: 'error', text: res.error ?? 'Failed to resume schedule.' })
        }
      }
      // Always refresh after pause/resume
      await loadScheduleData()
    } catch (err) {
      setScheduleStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Schedule action failed.' })
    } finally {
      setScheduleActionLoading(false)
    }
  }, [scheduleData, loadScheduleData])

  const handleTriggerNow = useCallback(async () => {
    if (!scheduleData) return
    setScheduleActionLoading(true)
    setScheduleStatusMessage(null)
    try {
      const res = await triggerScheduleNow(scheduleData.id)
      if (res.success) {
        setScheduleStatusMessage({ type: 'success', text: 'Schedule triggered! Execution will start shortly.' })
      } else {
        setScheduleStatusMessage({ type: 'error', text: res.error ?? 'Failed to trigger schedule.' })
      }
      // Refresh after trigger
      await loadScheduleData()
    } catch (err) {
      setScheduleStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to trigger schedule.' })
    } finally {
      setScheduleActionLoading(false)
    }
  }, [scheduleData, loadScheduleData])

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground flex" style={{ background: 'linear-gradient(135deg, hsl(120, 25%, 96%) 0%, hsl(140, 30%, 94%) 35%, hsl(160, 25%, 95%) 70%, hsl(100, 20%, 96%) 100%)' }}>
        {/* Sidebar */}
        <AppSidebar
          activeScreen={activeScreen}
          onNavigate={(screen) => {
            setActiveScreen(screen)
            if (screen !== 'create') setEditingAlert(null)
            setCreateStatusMessage(null)
          }}
          alertCount={displayAlerts.length}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
          {/* Top bar */}
          <header className="h-16 border-b border-border bg-card/40 backdrop-blur-[16px] flex items-center justify-between px-6 flex-shrink-0">
            <div className="flex items-center gap-3">
              <IoGolf className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">
                {activeScreen === 'dashboard' && 'Dashboard'}
                {activeScreen === 'create' && (editingAlert ? 'Edit Alert' : 'Create Alert')}
                {activeScreen === 'notifications' && 'Notification History'}
                {activeScreen === 'settings' && 'Settings'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="sample-toggle" className="text-xs text-muted-foreground font-medium cursor-pointer">
                Sample Data
              </Label>
              <Switch
                id="sample-toggle"
                checked={sampleMode}
                onCheckedChange={setSampleMode}
              />
            </div>
          </header>

          {/* Content area */}
          <main className="flex-1 overflow-y-auto p-6">
            {activeScreen === 'dashboard' && (
              <DashboardScreen
                alerts={displayAlerts}
                notifications={displayNotifications}
                onNavigateCreate={() => {
                  setEditingAlert(null)
                  setActiveScreen('create')
                }}
                onCheckNow={handleCheckNow}
                onToggleAlert={handleToggleAlert}
                onDeleteAlert={handleDeleteAlert}
                onEditAlert={handleEditAlert}
                checkingAlertId={checkingAlertId}
                activeAgentId={activeAgentId}
                statusMessages={statusMessages}
              />
            )}

            {activeScreen === 'create' && (
              <CreateAlertScreen
                editingAlert={editingAlert}
                onSave={handleSaveAlert}
                onCancel={() => {
                  setActiveScreen('dashboard')
                  setEditingAlert(null)
                  setCreateStatusMessage(null)
                }}
                isSaving={isSaving}
                statusMessage={createStatusMessage}
              />
            )}

            {activeScreen === 'notifications' && (
              <NotificationHistoryScreen notifications={displayNotifications} />
            )}

            {activeScreen === 'settings' && (
              <SettingsScreen
                defaultEmail={defaultEmail}
                setDefaultEmail={setDefaultEmail}
                defaultFrequency={defaultFrequency}
                setDefaultFrequency={setDefaultFrequency}
                emailEnabled={emailEnabled}
                setEmailEnabled={setEmailEnabled}
                scheduleData={scheduleData}
                scheduleLogs={scheduleLogs}
                scheduleLoading={scheduleLoading}
                scheduleError={scheduleError}
                onPauseResume={handlePauseResume}
                onTriggerNow={handleTriggerNow}
                onRefreshSchedule={loadScheduleData}
                scheduleActionLoading={scheduleActionLoading}
                scheduleStatusMessage={scheduleStatusMessage}
              />
            )}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  )
}
