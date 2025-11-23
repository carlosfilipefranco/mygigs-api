const port = process.env.PORT || 3001;

module.exports = {
	API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${port}/api`
};
