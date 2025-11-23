const express = require("express");
const session = require("express-session");
const path = require("path");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3001;

// ------------------
// API ROUTES
// ------------------
const artist = require("./routes/artist");
const venue = require("./routes/venue");
const city = require("./routes/city");
const gig = require("./routes/gig");
const event = require("./routes/event");
const festival = require("./routes/festival");
const edition = require("./routes/edition");
const setlist = require("./routes/setlist");
const user = require("./routes/user");
const userGig = require("./routes/userGig");

// ------------------
// ADMIN ROUTER
// ------------------
const adminRouter = require("./admin/admin");
const adminAuthRouter = require("./admin/auth");

// ------------------
// MIDDLEWARE
// ------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessões para o BackOffice
app.use(
	session({
		secret: "supersecret-admin-session",
		resave: false,
		saveUninitialized: true,
		cookie: { maxAge: 60 * 60 * 1000 } // 1 hora
	})
);

// ------------------
// CONFIG EJS
// ------------------
app.set("views", path.join(__dirname, "admin/views")); // pasta dos templates EJS
app.set("view engine", "ejs");

// Static files do BackOffice
app.use("/admin/static", express.static(path.join(__dirname, "admin/public")));

// ------------------
// ADMIN PAGES
// ------------------
// Auth rotas SEM proteção
app.use("/admin", adminAuthRouter);

// Admin rotas COM proteção
app.use("/admin", adminRouter);

// ------------------
// API BASE
// ------------------
app.get("/", (req, res) => {
	res.json({ message: "API is running" });
});

// ------------------
// API ROUTES
// ------------------
app.use("/api/artist", artist);
app.use("/api/venue", venue);
app.use("/api/city", city);
app.use("/api/gig", gig);
app.use("/api/event", event);
app.use("/api/festival", festival);
app.use("/api/edition", edition);
app.use("/api/setlist", setlist);
app.use("/api/user", user);
app.use("/api/user-gig", userGig);

// ------------------
// ERROR HANDLER
// ------------------
app.use((err, req, res, next) => {
	const statusCode = err.statusCode || 500;
	console.error(err.message, err.stack);
	res.status(statusCode).json({ message: err.message });
});

// ------------------
// START SERVER
// ------------------
app.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});
