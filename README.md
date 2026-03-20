# DeepAudit Backend

AI-powered codebase interrogator.

## Deployment on Vercel (Recommended Free Tier)

Vercel is **free forever** for "Hobby" projects. It handles the scaling, security, and deployment for you.

### Step-by-Step Setup:
1. **Push to GitHub**: (Already initialized).
2. **Login to [Vercel](https://vercel.com/)** using your GitHub account.
3. **Import Project**:
   - Click "Add New" -> "Project"
   - Install the GitHub integration if you haven't.
   - Select the `DeepAudit` repository.
4. **Configure Project**:
   - **Framework Preset**: Select "Other" (it will automatically pick up `vercel.json`).
   - **Environment Variables**: Open "Environment Variables" and add:
     - `GEMINI_API_KEY`: Your Google AI SDK key.
     - `GITHUB_TOKEN`: (Optional) Your GitHub personal access token.
5. **Deploy**: Click **Deploy**. Your app will be live at `https://your-project-name.vercel.app`.

## API Endpoints

### `POST /api/audit`
- **Body**: `{"repoUrl": "https://github.com/owner/repo"}`
- **Returns**: `githubStats` (Aggregated JSON) and `aiReport` (Markdown string).

## Free Tier Limits
- **Bandwidth**: 100GB/month.
- **Invocations**: 1 Million/month.
- **Execution Time**: 10 seconds per request (Enough for Gemini results).
- **Concurrency**: Up to 1,000 requests at a time.
