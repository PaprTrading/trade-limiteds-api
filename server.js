const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/inventory/:userId", async (req, res) => {
	const userId = req.params.userId;
	const full = req.query.full === "true";

	if (!userId || isNaN(userId)) {
		return res.status(400).json({ error: "Invalid userId" });
	}

	try {
		let allItems = [];
		let cursor = null;

		// Fetch all pages of collectibles
		do {
			const url = cursor
				? `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100&cursor=${cursor}`
				: `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100`;

			const response = await fetch(url, {
				headers: { "Accept": "application/json" }
			});

			if (!response.ok) {
				return res.status(200).json({
					userId,
					limitedCount: 0,
					rap: 0,
					private: true,
					items: []
				});
			}

			const data = await response.json();
			const items = data.data || [];
			allItems = allItems.concat(items);
			cursor = data.nextPageCursor;

		} while (cursor);

		// Calculate totals
		let totalRap = 0;
		for (const item of allItems) {
			if (item.recentAveragePrice) {
				totalRap += item.recentAveragePrice;
			}
		}

		// If full=true, return item details
		if (full) {
			const itemDetails = allItems.map(item => ({
				assetId: item.assetId,
				name: item.name,
				rap: item.recentAveragePrice || 0,
				serialNumber: item.serialNumber || null,
			}));

			return res.status(200).json({
				userId,
				limitedCount: allItems.length,
				rap: totalRap,
				private: false,
				items: itemDetails
			});
		}

		return res.status(200).json({
			userId,
			limitedCount: allItems.length,
			rap: totalRap,
			private: false
		});

	} catch (err) {
		console.error("Error:", err);
		return res.status(500).json({ error: "Failed to fetch inventory" });
	}
});

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

			for (const item of items) {
				if (item.recentAveragePrice) totalRap += item.recentAveragePrice;
			}

			results.push({ userId, limitedCount: items.length, rap: totalRap, private: false });

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
