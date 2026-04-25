# 🚀 Complete Northflank Deployment Guide

This is a **complete step-by-step guide** to deploy your File2Link bot on Northflank.

## ✅ Prerequisites

- ✅ Northflank account (sign up free at https://northflank.com)
- ✅ GitHub account connected to Northflank
- ✅ Your environment variables ready:
  - `TELEGRAM_BOT_TOKEN` (from BotFather)
  - `LOG_CHANNEL_ID` (your Telegram log channel ID)

---

## 📋 Step-by-Step Setup

### **STEP 1: Create a Northflank Project**

1. Go to https://northflank.com and log in
2. Click **"Create New Project"** (or "New" button)
3. Enter:
   - **Project Name**: `File2Link-Bot`
   - **Description**: `Telegram File to Link Bot with FFmpeg streaming`
4. Click **Create**

---

### **STEP 2: Add a Docker Service**

1. Click **"Add Service"**
2. Select **"Docker"** from the options
3. You'll see GitHub integration options:
   - Click **"GitHub"**
   - Click **"Connect GitHub"** (if not already connected)
   - Authorize Northflank to access your repos
4. Select:
   - **Repository**: `File2Link-PrimeAutoBotz`
   - **Branch**: `main`
   - **Dockerfile Path**: `./Dockerfile` (default is fine)
5. Click **"Select"** or **"Continue"**

---

### **STEP 3: Configure Service Settings**

#### **Basic Info:**
- **Service Name**: `api-server`
- **Description**: `File2Link Telegram Bot`

#### **Build Settings:**
- **Build Type**: Docker ✓
- **Dockerfile**: `./Dockerfile` 
- **Build Context**: `.` (root)
- **Registry**: Northflank (default)

#### **Port Configuration:**
- Click **"Ports"**
- Add port mapping:
  - **Container Port**: `8080`
  - **Protocol**: `HTTP`
  - **Public**: ✓ (enable public access)

---

### **STEP 4: Set Environment Variables**

1. Go to **"Variables"** section
2. Click **"Add Variable"**
3. Add these variables (one by one):

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `LOG_CHANNEL_ID` | Your Telegram channel ID |
| `PORT` | `8080` |
| `BASE_URL` | Leave empty for now (we'll update after first deployment) |

**Example:**
```
TELEGRAM_BOT_TOKEN = 1234567890:ABCDEFGHijklmnopqrstuvwxyz
LOG_CHANNEL_ID = -1001234567890
PORT = 8080
```

---

### **STEP 5: Resource Configuration**

1. Go to **"Resources"** section
2. Set:
   - **CPU**: `0.5` core (free tier) or `1` if available
   - **Memory**: `512 MB` (free tier) or `1 GB` if available
   - **Replicas**: `1`
   - **Restart Policy**: `Always`

---

### **STEP 6: Health Check (Optional but Recommended)**

1. Go to **"Health Checks"**
2. Enable health check:
   - **Type**: HTTP
   - **Path**: `/api/healthz`
   - **Port**: `8080`
   - **Interval**: `30` seconds
   - **Timeout**: `10` seconds
   - **Initial Delay**: `10` seconds

---

### **STEP 7: Deploy! 🚀**

1. Click **"Deploy"** button
2. You'll see deployment progress:
   ```
   Building Docker image...
   Pushing to registry...
   Deploying container...
   Starting service...
   ```
3. Wait for status to show: **"Running"** ✅

---

## 📊 After Deployment

### **Get Your Public URL:**

1. Once deployed, click on your service
2. Look for **"Public URL"** or **"Domain"**
3. Copy this URL (e.g., `https://api-server-abc123.northflank.app`)

### **Test the Bot:**

1. Open Telegram
2. Search for `@filetolink_05bot`
3. Send `/start`
4. You should see:
   ```
   🔒 Join Channel
   You must join PrimeAutoBotz to use this bot.
   ```
5. Click "Join Channel" button ✅

### **Test Health Check:**

1. Visit: `https://your-url/api/healthz`
2. Should see: `{"status":"ok"}` ✅

---

## 🔧 Troubleshooting

### **Build Fails - "File not found"**
- **Issue**: Docker can't find files
- **Fix**: Make sure all paths in Dockerfile are relative
- **Status**: Our Dockerfile is already fixed ✓

### **Container Won't Start**
- **Solution**:
  1. Check **Logs** tab in Northflank
  2. Look for error messages
  3. Common issues:
     - Missing `TELEGRAM_BOT_TOKEN` → Add it to Variables
     - Wrong port → Should be 8080
     - Dependency error → Check if pnpm-lock.yaml is committed

### **FFmpeg Error (spawn error)**
- **Fixed**: Our Dockerfile includes FFmpeg
- **Verify**: Check logs for "ffmpeg" errors
- **If still failing**: Use `apk add ffmpeg` might need `ffmpeg-full`

### **Health Check Failing**
- **Check**: Logs in Northflank dashboard
- **Verify**: API is actually running on port 8080
- **Debug**: SSH into container and check manually

### **Bot Not Responding**
- **Check**: Is service "Running"?
- **Verify**: TELEGRAM_BOT_TOKEN is correct
- **Redeploy**: Make a git commit and redeploy

---

## 🔄 How to Redeploy

After making code changes:

1. Commit changes to GitHub:
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. Northflank detects changes automatically
3. Service redeploys with new code
4. No manual action needed ✓

---

## 💾 Updating Environment Variables

If you need to change env vars (like BASE_URL):

1. Go to your service in Northflank
2. Click **"Variables"**
3. Edit the variable
4. Click **"Redeploy"** button
5. Wait for redeployment ✅

---

## 📱 Update Bot Webhook (Optional)

If using webhook instead of polling (more efficient):

1. Go to Telegram BotFather
2. Send: `/setwebhook`
3. Enter your URL: `https://your-northflank-url/api/webhook`
4. Should show: "Webhook was set"

But polling (current method) works great too!

---

## 🎯 Success Checklist

- ✅ Project created on Northflank
- ✅ GitHub repo connected
- ✅ Docker service added
- ✅ Environment variables set
- ✅ Health check configured
- ✅ Service deployed (status: Running)
- ✅ Bot responds to `/start` on Telegram
- ✅ FFmpeg streaming works (test with a video file)

---

## 📞 Getting Help

**Northflank Docs**: https://docs.northflank.com  
**Northflank Support**: https://northflank.com/help  
**Bot Issues**: Check Northflank dashboard Logs tab

---

## 🎉 Your Bot is Live!

Visit: `https://t.me/filetolink_05bot`

Users can now:
- ✅ Join @PrimeAutoBotz channel (force join message)
- ✅ Send files for download/stream links
- ✅ Stream videos and audio directly
- ✅ Download all file types

**Congratulations! 🚀**
