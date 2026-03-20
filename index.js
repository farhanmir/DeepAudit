const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
  res.send('DeepAudit Backend is Live! (Vercel Bridge Mode)');
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


function extractRepoInfo(url) {
  try {
    // Basic regex or URL parsing
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    
    // e.g. /owner/repo
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, '')
    };
  } catch (err) {
    return null;
  }
}

app.post('/api/audit', async (req, res) => {
  // Vercel sometimes pre-parses the body. If not, Express might need it.
  const body = req.body || {};
  const { repoUrl } = body;
  
  if (!repoUrl) {
    return res.status(400).json({ 
      error: 'repoUrl is required in the JSON body.',
      receivedBody: body 
    });
  }


  const repoInfo = extractRepoInfo(repoUrl);
  if (!repoInfo) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL provided.' });
  }

  const { owner, repo } = repoInfo;

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'DeepAudit-App'
    };

    // If you add GITHUB_TOKEN to .env, uncomment this to avoid aggressive rate limits
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const endpoints = [
      `https://api.github.com/repos/${owner}/${repo}`,
      `https://api.github.com/repos/${owner}/${repo}/languages`,
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`
    ];

    // Fetch all endpoints concurrently
    const [baseRes, langsRes, commitsRes] = await Promise.all(
      endpoints.map(url => fetch(url, { headers }))
    );

    // Identify failures gracefully
    if (!baseRes.ok || !langsRes.ok || !commitsRes.ok) {
      const status = baseRes.status !== 200 ? baseRes.status : 
                     (langsRes.status !== 200 ? langsRes.status : commitsRes.status);
      
      const failingRes = baseRes.status !== 200 ? baseRes : 
                         (langsRes.status !== 200 ? langsRes : commitsRes);
      
      const errorData = await failingRes.json().catch(() => ({}));
      
      let message = 'Failed to fetch repository data from GitHub.';
      if (status === 404) message = 'Repository not found or is private.';
      if (status === 403 || status === 429) message = 'GitHub API rate limit exceeded. You likely need a GITHUB_TOKEN on Vercel.';
      
      return res.status(status >= 500 ? 500 : 400).json({ 
        error: message, 
        githubStatus: status,
        githubError: errorData
      });
    }


    // Parse raw JSON
    const baseData = await baseRes.json();
    const langsData = await langsRes.json();
    const commitsDataBody = await commitsRes.json();

    const commitsList = Array.isArray(commitsDataBody) ? commitsDataBody : [];

    // Compile single clean summary object
    const githubStats = {
      name: baseData.name,
      owner: baseData.owner.login,
      description: baseData.description,
      stars: baseData.stargazers_count,
      forks: baseData.forks_count,
      open_issues: baseData.open_issues_count,
      languages: langsData,
      recent_commits: commitsList.map(c => ({
        message: c.commit.message,
        date: c.commit.author?.date,
        author: c.commit.author?.name
      }))
    };

    // Prompt Gemini
    const systemInstruction = `You are a ruthless, elite Principal Engineer doing an architectural review. Analyze the provided GitHub repo data. Be brutally honest, highly technical, and direct. Roast their commit message quality, evaluate their language sprawl, and assess their technical debt based on the open-issues-to-stars ratio. Format your response in clean Markdown.`;
    
    const prompt = `${systemInstruction}\n\nHere is the GitHub repository data to analyze:\n${JSON.stringify(githubStats, null, 2)}`;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const aiReport = result.response.text();

    // Output payload
    return res.status(200).json({
      githubStats,
      aiReport
    });

  } catch (error) {
    console.error('[Audit Error]', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred during the audit.', 
      details: error.message 
    });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`DeepAudit server running on port ${PORT}`);
  });
}

module.exports = app;

