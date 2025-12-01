"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { Bot, Settings2, Loader2, CheckCircle, Sparkles, Cpu, MessageSquare } from "lucide-react"
import { redirect } from "next/navigation"

interface SystemSettings {
  ai_chatbot_enabled: string
  ai_model_primary: string
  ai_model_fallback: string
  welcome_message: string
}

const AI_MODELS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable model' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast & efficient' },
  { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview (05-20)', description: 'Latest preview' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Lightweight' },
  { value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite Preview (06-17)', description: 'Preview lite' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Stable & reliable' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: 'Fastest' },
]

export default function AISettingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    ai_chatbot_enabled: 'true',
    ai_model_primary: 'gemini-2.5-flash',
    ai_model_fallback: 'gemini-2.0-flash',
    welcome_message: '',
  })

  // Redirect non-superadmin
  useEffect(() => {
    if (user && user.role !== 'superadmin') {
      redirect('/dashboard')
    }
  }, [user])

  // Fetch system settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/settings', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        })
        if (response.ok) {
          const data = await response.json()
          setSystemSettings(prev => ({ ...prev, ...data.data }))
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const handleAIChatbotToggle = async (enabled: boolean) => {
    const newValue = enabled ? 'true' : 'false'
    setSystemSettings({ ...systemSettings, ai_chatbot_enabled: newValue })

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          key: 'ai_chatbot_enabled',
          value: newValue,
          description: 'Enable/disable AI chatbot feature',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update setting')
      }

      toast({
        title: enabled ? "AI Chatbot Enabled" : "AI Chatbot Disabled",
        description: enabled 
          ? "AI chatbot will now respond to incoming messages" 
          : "AI chatbot will not respond to incoming messages",
      })
    } catch (error) {
      // Revert on error
      setSystemSettings({ ...systemSettings, ai_chatbot_enabled: enabled ? 'false' : 'true' })
      toast({
        title: "Error",
        description: "Failed to toggle AI chatbot",
        variant: "destructive",
      })
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          settings: systemSettings,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update settings')
      }

      toast({
        title: "Settings Saved",
        description: "AI chatbot settings have been updated successfully",
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading AI settings...</p>
        </div>
      </div>
    )
  }

  if (user?.role !== 'superadmin') {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          AI Chatbot Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure AI chatbot behavior, models, and responses
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI Status Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-500" />
              AI Chatbot Status
            </CardTitle>
            <CardDescription>
              Enable or disable the AI chatbot for handling WhatsApp messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
              <div className="space-y-1">
                <Label className="text-base font-medium">Enable AI Chatbot</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, AI will automatically classify and respond to WhatsApp messages from citizens
                </p>
              </div>
              <Switch
                checked={systemSettings.ai_chatbot_enabled === 'true'}
                onCheckedChange={handleAIChatbotToggle}
                className="scale-125"
              />
            </div>
            
            <div className="mt-4 flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${systemSettings.ai_chatbot_enabled === 'true' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className={`text-sm font-medium ${systemSettings.ai_chatbot_enabled === 'true' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {systemSettings.ai_chatbot_enabled === 'true' ? 'AI Chatbot is Active' : 'AI Chatbot is Inactive'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Primary Model Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-500" />
              Primary AI Model
            </CardTitle>
            <CardDescription>
              The main AI model used for processing messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai_model_primary">Select Model</Label>
              <Select 
                value={systemSettings.ai_model_primary} 
                onValueChange={(value) => setSystemSettings({ ...systemSettings, ai_model_primary: value })}
              >
                <SelectTrigger id="ai_model_primary" className="w-full">
                  <SelectValue placeholder="Select primary model" />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      <div className="flex flex-col">
                        <span>{model.label}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This model will be used first for all AI operations
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Fallback Model Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-orange-500" />
              Fallback AI Model
            </CardTitle>
            <CardDescription>
              Backup model if primary model fails or is unavailable
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai_model_fallback">Select Model</Label>
              <Select 
                value={systemSettings.ai_model_fallback} 
                onValueChange={(value) => setSystemSettings({ ...systemSettings, ai_model_fallback: value })}
              >
                <SelectTrigger id="ai_model_fallback" className="w-full">
                  <SelectValue placeholder="Select fallback model" />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      <div className="flex flex-col">
                        <span>{model.label}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used when the primary model encounters errors or rate limits
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Welcome Message Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-500" />
              Welcome Message
            </CardTitle>
            <CardDescription>
              Custom greeting message for new users (optional)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="welcome_message">Message Template</Label>
              <Textarea
                id="welcome_message"
                value={systemSettings.welcome_message}
                onChange={(e) => setSystemSettings({ ...systemSettings, welcome_message: e.target.value })}
                placeholder="Selamat datang di GovConnect! Saya siap membantu Anda dengan layanan pemerintah..."
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use the default AI-generated welcome message
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSaveSettings} 
          disabled={saving}
          size="lg"
          className="min-w-[200px]"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Save All Settings
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
