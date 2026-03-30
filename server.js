// ============================================================
// Railway.app Node.js Server
// This fetches real Roblox inventory data for your game
// ============================================================

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================================
// GET /inventory/:userId
// Returns limited count and RAP estimate for a Roblox user
// ============================================================

app.get("/inventory/:userId", async (req, res) => {
	const userId = req.params.userId;

	if (!userId || isNaN(userId)) {
		return res.status(400).json({ error: "Invalid userId" });
	}

	try {
		// Fetch user's collectibles (limiteds) from Roblox API
		const collectiblesUrl = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100`;

		const response = await fetch(collectiblesUrl, {
			headers: {
				"Accept": "application/json"
			}
		});

		if (!response.ok) {
			// Roblox inventory may be private
			return res.status(200).json({
				userId: userId,
				limitedCount: 0,
				rap: 0,
				private: true
			});
		}

		const data = await response.json();
		const items = data.data || [];

		// Count limiteds and total RAP
		let totalRap = 0;
		let limitedCount = items.length;

		for (const item of items) {
			if (item.recentAveragePrice) {
				totalRap += item.recentAveragePrice;
			}
		}

		// If there are more pages, fetch them
		let cursor = data.nextPageCursor;
		while (cursor) {
			const nextRes = await fetch(
				`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100&cursor=${cursor}`,
				{ headers: { "Accept": "application/json" } }
			);
			if (!nextRes.ok) break;
			const nextData = await nextRes.json();
			const nextItems = nextData.data || [];
			limitedCount += nextItems.length;
			for (const item of nextItems) {
				if (item.recentAveragePrice) {
					totalRap += item.recentAveragePrice;
				}
			}
			cursor = nextData.nextPageCursor;
		}

		return res.status(200).json({
			userId: userId,
			limitedCount: limitedCount,
			rap: totalRap,
			private: false
		});

	} catch (err) {
		console.error("Error fetching inventory:", err);
		return res.status(500).json({ error: "Failed to fetch inventory" });
	}
});

// ============================================================
// GET /batch
// Accepts ?userIds=123,456,789 and returns data for all of them
// ============================================================

app.get("/batch", async (req, res) => {
	const raw = req.query.userIds;
	if (!raw) return res.status(400).json({ error: "No userIds provided" });

	const userIds = raw.split(",").map(id => id.trim()).filter(id => !isNaN(id));
	if (userIds.length === 0) return res.status(400).json({ error: "Invalid userIds" });

	const results = [];

	for (const userId of userIds) {
		try {
			const response = await fetch(
				`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100`,
				{ headers: { "Accept": "application/json" } }
			);

			if (!response.ok) {
				results.push({ userId, limitedCount: 0, rap: 0, private: true });
				continue;
			}

			const data = await response.json();
			const items = data.data || [];
			let totalRap = 0;
			let limitedCount = items.length;

			for (const item of items) {
				if (item.recentAveragePrice) totalRap += item.recentAveragePrice;
			}

			results.push({ userId, limitedCount, rap: totalRap, private: false });

		} catch (e) {
			results.push({ userId, limitedCount: 0, rap: 0, private: true });
		}
	}

	return res.status(200).json({ results });
});

app.get("/", (req, res) => {
	res.send("Trade Limiteds API is running.");
});

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
