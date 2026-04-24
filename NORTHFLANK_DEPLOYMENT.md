# Deploying to Northflank 🚀

This guide walks you through deploying the File2Link bot to Northflank.

## Prerequisites

1. **Northflank Account** - Sign up at https://northflank.com
2. **GitHub Connected** - Link your GitHub account to Northflank
3. **Environment Variables** - Have your `.env` values ready

## Step 1: Create a Northflank Project

1. Go to [northflank.com](https://northflank.com)
2. Click **"Create Project"**
3. Enter project name: `file2link-primeautobotz`
4. Click **Create**

## Step 2: Connect GitHub Repository

1. In your Northflank project, click **"Add Service"**
2. Select **"Docker"** as the service type
3. Click **"Connect GitHub"**
4. Authorize Northflank to access your GitHub account
5. Select repository: `File2Link-PrimeAutoBotz`
6. Select branch: `main`
7. Click **Connect**

## Step 3: Configure Service

### Basic Settings:
- **Service Name**: `api-server`
- **Dockerfile Path**: `./Dockerfile` (already provided)
- **Build Context**: `.` (root directory)

### Port Configuration:
- **Internal Port**: `8080`
- **Protocol**: `HTTP`
- **Public URL**: Enable (to get a domain)

### Resource Settings (Free Tier):
- **CPU**: 0.5 core
- **Memory**: 512MB
- **Storage**: Not needed (stateless)

## Step 4: Set Environment Variables

In the Northflank service settings, add these environment variables:

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
LOG_CHANNEL_ID=your_log_channel_id_here
BASE_URL=https://your-northflank-domain.app
PORT=8080
```

**How to find these values:**
- `TELEGRAM_BOT_TOKEN`: From Telegram BotFather
- `LOG_CHANNEL_ID`: Your Telegram channel ID (from previous Railway setup)
- `BASE_URL`: Will be provided by Northflank after deployment (e.g., `https://api-server-abc123.northflank.app`)
- `PORT`: Keep as 8080

## Step 5: Configure Build Settings

1. **Build Type**: Docker
2. **Registry**: Northflank (default)
3. **Build Command**: Leave empty (Dockerfile handles it)
4. **Build Context**: `.`
5. **Dockerfile**: `./Dockerfile`

## Step 6: Health Check Setup

Northflank should auto-detect from the `HEALTHCHECK` in Dockerfile:
- **Path**: `/api/healthz`
- **Interval**: 30s
- **Timeout**: 10s
- **Retries**: 3

## Step 7: Deploy

1. Click **"Deploy"**
2. Northflank will:
   - Build the Docker image
   - Install dependencies
   - Build TypeScript code
   - Deploy the container

3. Wait for status to show **"Running"** ✅

## Step 8: Verify Deployment

1. Once deployed, click the **"Public URL"** 
2. Append `/api/healthz` to check health: `https://your-url/api/healthz`
3. Should return `{"status":"ok"}`

4. Test the bot:
   - Open Telegram
   - Search for `@filetolink_05bot`
   - Send `/start`
   - Should see force join message

## Step 9: Update Your Bot Commands (Optional)

If you want to use the Northflank URL as your webhook (more stable than polling):

In BotFather:
```
/setwebhook
Enter webhook URL: https://your-northflank-domain/api/webhook
```

But polling (current method) works fine too!

## Troubleshooting

### Container Won't Start
- Check logs in Northflank dashboard
- Verify `TELEGRAM_BOT_TOKEN` is set correctly
- Ensure `PORT=8080` is set

### FFmpeg Errors
- The Dockerfile includes FFmpeg - should work automatically
- If still failing, check logs for the exact error

### Health Check Failing
- Ensure server is actually listening on port 8080
- Check that `healthcheckPath` in `railway.toml` exists (we have `/api/healthz`)

### Environment Variables Not Loading
- Redeploy after adding variables
- Northflank needs a re-deployment to apply new env vars

## Benefits of Northflank vs Railway

✅ **Better Performance**: Larger free tier resources  
✅ **FFmpeg Included**: Dockerfile has it built-in  
✅ **Docker Flexibility**: Easy to customize anything  
✅ **Good Scaling**: Easy to upgrade resources  
✅ **Cold Start**: Might be slightly slower initially but better sustained performance  

## Database Setup (if needed)

If you're using Postgres, Northflank can provision it:
1. Add a **Postgres** service in your project
2. Copy connection string to `DATABASE_URL` env var
3. Run migrations: Add init script to Dockerfile if needed

## Next Steps After Deployment

1. **Monitor Logs**: Check Northflank dashboard regularly
2. **Set Up Alerts**: Configure notifications for deployment failures
3. **Scale if needed**: Increase CPU/RAM from Northflank dashboard
4. **Backup**: Regularly backup any user data

## Support

For Northflank help: https://docs.northflank.com  
For bot issues: Check the logs in Northflank dashboard

---

**Your Telegram Bot URL will be:** `https://t.me/filetolink_05bot`

The force join to `@PrimeAutoBotz` will work the same way! 🎉
