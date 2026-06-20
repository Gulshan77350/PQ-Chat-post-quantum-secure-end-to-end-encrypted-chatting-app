import db from "../../lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../../models/Users";
import { getIO, getPresenceSnapshot } from "../../lib/socket";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey123";

export default async function handler(req, res) {
  try {
    await db(); // ensure DB connection
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    return res.status(500).json({ message: "Database connection failed" });
  }

  const { method } = req;

  switch (method) {
    /**
     * 🧩 REGISTER (POST /api/users)
     */
    case "POST":
  try {
    const { username, password, publicKey } = req.body;  // ← add publicKey
    if (!username || !password)
      return res.status(400).json({ message: "Username and password are required" });

    const existingUser = await User.findOne({ username });
    if (existingUser)
      return res.status(400).json({ message: "Username already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: username.trim(),
      password: hashedPassword,
      publicKey: publicKey || null,   // ← save it
      online: false,
      socketId: null,
    });
    await newUser.save();
    // ... rest unchanged

        // Broadcast to all connected clients (update user list)
        try {
          const io = getIO();
          io.emit("users:changed");
        } catch (err) {
          console.warn("⚠️ Socket.IO not initialized yet, skipping emit");
        }

        return res.status(201).json({ message: "User registered successfully" });
      } catch (err) {
        console.error("POST /api/users error:", err);
        return res.status(500).json({ message: "Server error" });
      }

    /**
     * 🧩 LOGIN (PUT /api/users)
     */
    case "PUT":
      try {
        const { username, password } = req.body;
        if (!username || !password)
          return res.status(400).json({ message: "Username and password are required" });

        const user = await User.findOne({ username });
        if (!user)
          return res.status(404).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
          return res.status(401).json({ message: "Invalid credentials" });

        const token = jwt.sign(
          { id: user._id, username: user.username },
          JWT_SECRET,
          { expiresIn: "1d" }
        );

        // ✅ Optional: mark as recently active
        await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });

        return res.status(200).json({
          message: "Login successful",
          token,
          username: user.username,
        });
      } catch (err) {
        console.error("PUT /api/users error:", err);
        return res.status(500).json({ message: "Server error" });
      }

    /**
     * 🧩 RESET PASSWORD (PATCH /api/users)
     */
    case "PATCH":
      try {
        const { username, newPassword } = req.body;
        if (!username || !newPassword)
          return res.status(400).json({ message: "Username and new password are required" });

        const user = await User.findOne({ username });
        if (!user)
          return res.status(404).json({ message: "User not found" });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        return res.status(200).json({ message: "Password updated successfully" });
      } catch (err) {
        console.error("PATCH /api/users error:", err);
        return res.status(500).json({ message: "Server error" });
      }

    /**
     * 🧩 FETCH ALL USERS (GET /api/users or /api/users?q=search)
     */
    case "GET":
      try {
        const { q } = req.query;
        const filter = q
          ? { username: { $regex: q, $options: "i" } }
          : {};

        // Fetch all users except password
        const users = await User.find(filter).select("-password").lean();

        // Merge socket presence
        const presence = getPresenceSnapshot();
        const merged = users.map((u) => ({
          ...u,
          online: !!presence[u.username],
          socketId: presence[u.username] || null,
        }));

        // Sort online users first for better UX
        merged.sort((a, b) => b.online - a.online);

        return res.status(200).json(merged);
      } catch (err) {
        console.error("GET /api/users error:", err);
        return res.status(500).json({ message: "Server error" });
      }

    default:
      res.setHeader("Allow", ["GET", "POST", "PUT", "PATCH"]);
      return res.status(405).end(`Method ${method} Not Allowed`);
  }
}
