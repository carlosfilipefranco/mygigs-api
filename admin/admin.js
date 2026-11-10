const express = require("express");
const router = express.Router();
const isAdmin = require("./middleware/auth");
const adminController = require("./controllers/admin.controller");

router.get("/", isAdmin, adminController.dashboard);
router.get("/users", isAdmin, adminController.users);

module.exports = router;
