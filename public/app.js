let currentUser = null;

// Check authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupEventListeners();
});

async function checkAuth() {
    try {
        const response = await fetch('/auth/user');
        if (response.ok) {
            currentUser = await response.json();
            showAuthenticatedUI();
        } else {
            showLoginUI();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoginUI();
    }
}

function showAuthenticatedUI() {
    document.getElementById('user-email').textContent = currentUser.email || currentUser.name;
    document.getElementById('logout-btn').style.display = 'inline-block';
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('crawler-section').style.display = 'block';

    // Load recent jobs
    loadRecentJobs();
}

function showLoginUI() {
    document.getElementById('user-email').textContent = 'Not logged in';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('login-btn').style.display = 'inline-block';
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('crawler-section').style.display = 'none';
}

function setupEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('crawl-form').addEventListener('submit', handleCrawlSubmit);
}

function login() {
    window.location.href = '/auth/login';
}

function logout() {
    window.location.href = '/auth/logout';
}

async function handleCrawlSubmit(event) {
    event.preventDefault();

    const url = document.getElementById('url').value;
    const maxDepth = parseInt(document.getElementById('maxDepth').value);

    try {
        const response = await fetch('/api/crawler/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, maxDepth })
        });

        if (response.ok) {
            const result = await response.json();
            showAlert('Crawl job submitted successfully!', 'success');

            // Show status
            document.getElementById('crawl-status').style.display = 'block';
            document.getElementById('status-content').textContent = JSON.stringify(result, null, 2);

            // Reset form
            document.getElementById('crawl-form').reset();

            // Reload jobs list
            setTimeout(() => loadRecentJobs(), 1000);
        } else {
            const error = await response.json();
            showAlert('Failed to submit crawl job: ' + error.error, 'error');
        }
    } catch (error) {
        console.error('Crawl submit error:', error);
        showAlert('Failed to submit crawl job', 'error');
    }
}

async function loadRecentJobs() {
    try {
        const response = await fetch('/api/crawler/jobs');
        if (response.ok) {
            const data = await response.json();
            displayJobs(data.jobs);
        } else {
            document.getElementById('jobs-list').innerHTML = '<p>Failed to load jobs</p>';
        }
    } catch (error) {
        console.error('Load jobs error:', error);
        document.getElementById('jobs-list').innerHTML = '<p>Failed to load jobs</p>';
    }
}

function displayJobs(jobs) {
    const jobsList = document.getElementById('jobs-list');

    if (jobs.length === 0) {
        jobsList.innerHTML = '<p>No crawl jobs yet. Submit a URL above to get started!</p>';
        return;
    }

    jobsList.innerHTML = jobs.map(job => `
        <div class="job-item ${job.status}">
            <div class="job-url">${job.url}</div>
            <div class="job-meta">
                <span class="status-badge ${job.status}">${job.status}</span>
                <span>Depth: ${job.maxDepth}</span>
                <span>Submitted: ${new Date(job.submittedAt).toLocaleString()}</span>
                ${job.pagesProcessed ? `<span>Pages: ${job.pagesProcessed}</span>` : ''}
            </div>
        </div>
    `).join('');
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;

    const main = document.querySelector('main');
    main.insertBefore(alertDiv, main.firstChild);

    setTimeout(() => alertDiv.remove(), 5000);
}
