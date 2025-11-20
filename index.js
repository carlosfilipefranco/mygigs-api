const express = require("express");
const app = express();
const port = 3000;
const artist = require("./routes/artist");
const venue = require("./routes/venue");
const city = require("./routes/city");
const gig = require("./routes/gig");
const event = require("./routes/event");
const festival = require("./routes/festival");
const edition = require("./routes/edition");
const setlist = require("./routes/setlist");
const user = require("./routes/user");
const cors = require("cors");

app.use(cors());

app.use(express.json());
app.use(
	express.urlencoded({
		extended: true
	})
);

app.get("/", (req, res) => {
	res.json({ message: "ok" });
});

app.use("/artist", artist);
app.use("/venue", venue);
app.use("/city", city);
app.use("/gig", gig);
app.use("/event", event);
app.use("/festival", festival);
app.use("/edition", edition);
app.use("/setlist", setlist);
app.use("/user", user);

/* Error handler middleware */
app.use((err, req, res, next) => {
	const statusCode = err.statusCode || 500;
	console.error(err.message, err.stack);
	res.status(statusCode).json({ message: err.message });

	return;
});

app.listen(process.env.PORT || port, () => {
	console.log(`Example app listening at http://localhost:${port}`);
});
