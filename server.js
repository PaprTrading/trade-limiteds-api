const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================================
// GET /inventory/:userId?full=true
// ============================================================

app.get("/inventory/:userId", async (req, res) => {
	const userId = req.params.userId;
	const full = req.query.full === "true";
	if (!userId || isNaN(userId)) return res.status(400).json({ error: "Invalid userId" });

	try {
		let allItems = [];
		let cursor = null;

		do {
			const url = cursor
				? `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100&cursor=${cursor}`
				: `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100`;

			const response = await fetch(url, { headers: { "Accept": "application/json" } });
			if (!response.ok) {
				return res.status(200).json({ userId, limitedCount: 0, rap: 0, private: true, items: [] });
			}
			const data = await response.json();
			allItems = allItems.concat(data.data || []);
			cursor = data.nextPageCursor;
		} while (cursor);

		let totalRap = 0;
		for (const item of allItems) {
			if (item.recentAveragePrice) totalRap += item.recentAveragePrice;
		}

		if (full) {
			const assetIds = allItems.map(i => i.assetId).filter(Boolean);
			const thumbnails = {};

			// Batch thumbnails
			for (let i = 0; i < assetIds.length; i += 100) {
				const batch = assetIds.slice(i, i + 100).join(",");
				try {
					const r = await fetch(
						`https://thumbnails.roblox.com/v1/assets?assetIds=${batch}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`,
						{ headers: { "Accept": "application/json" } }
					);
					if (r.ok) {
						const d = await r.json();
						for (const t of (d.data || [])) thumbnails[t.targetId] = t.imageUrl;
					}
				} catch (e) {}
			}

			// Items returned - no extra catalog calls needed
			const itemDetails = allItems.map(item => {
				return {
					assetId: item.assetId,
					name: item.name,
					rap: item.recentAveragePrice || 0,
					serialNumber: item.serialNumber || null,
					imageUrl: thumbnails[item.assetId] || ""
				};
			});

			return res.status(200).json({ userId, limitedCount: allItems.length, rap: totalRap, private: false, items: itemDetails });
		}

		return res.status(200).json({ userId, limitedCount: allItems.length, rap: totalRap, private: false });

	} catch (err) {
		console.error("Error:", err);
		return res.status(500).json({ error: "Failed to fetch inventory" });
	}
});

// ============================================================
// GET /itemdetails/:assetId
// Full item info + RAP price history chart
// ============================================================

app.get("/itemdetails/:assetId", async (req, res) => {
	const assetId = req.params.assetId;
	if (!assetId || isNaN(assetId)) return res.status(400).json({ error: "Invalid assetId" });

	try {
		const [detailsRes, rapRes, thumbRes] = await Promise.all([
			fetch("https://catalog.roblox.com/v1/catalog/items/details", {
				method: "POST",
				headers: { "Content-Type": "application/json", "Accept": "application/json" },
				body: JSON.stringify({ items: [{ itemType: "Asset", id: Number(assetId) }] })
			}),
			fetch(`https://economy.roblox.com/v1/assets/${assetId}/resale-data`, {
				headers: { "Accept": "application/json" }
			}),
			fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`, {
				headers: { "Accept": "application/json" }
			})
		]);

		let details = {};
		let rapHistory = [];
		let imageUrl = "";

		if (detailsRes.ok) {
			const d = await detailsRes.json();
			const asset = (d.data || [])[0] || {};
			details = {
				name: asset.name || "",
				description: asset.description || "",
				originalPrice: asset.price || asset.lowestPrice || 0,
				rap: asset.recentAveragePrice || 0,
				creator: asset.creatorName || "Roblox",
			};
		}

		if (rapRes.ok) {
			const r = await rapRes.json();
			rapHistory = (r.priceDataPoints || []).map(p => ({
				price: p.value,
				date: p.date
			}));
			if (r.originalPrice && !details.originalPrice) {
				details.originalPrice = r.originalPrice;
			}
		}

		if (thumbRes.ok) {
			const t = await thumbRes.json();
			imageUrl = ((t.data || [])[0] || {}).imageUrl || "";
		}

		return res.status(200).json({ assetId, details, rapHistory, imageUrl });

	} catch (err) {
		console.error("Item details error:", err);
		return res.status(500).json({ error: "Failed to fetch item details" });
	}
});

// ============================================================
// GET /batch?userIds=123,456
// ============================================================

app.get("/batch", async (req, res) => {
	const raw = req.query.userIds;
	if (!raw) return res.status(400).json({ error: "No userIds" });
	const userIds = raw.split(",").map(id => id.trim()).filter(id => !isNaN(id));
	const results = [];
	for (const userId of userIds) {
		try {
			const response = await fetch(
				`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100`,
				{ headers: { "Accept": "application/json" } }
			);
			if (!response.ok) { results.push({ userId, limitedCount: 0, rap: 0, private: true }); continue; }
			const data = await response.json();
			const items = data.data || [];
			let totalRap = 0;
			for (const item of items) { if (item.recentAveragePrice) totalRap += item.recentAveragePrice; }
			results.push({ userId, limitedCount: items.length, rap: totalRap, private: false });
		} catch (e) {
			results.push({ userId, limitedCount: 0, rap: 0, private: true });
		}
	}
	return res.status(200).json({ results });
});

// ============================================================
// GET /headshots?userIds=123,456
// ============================================================

app.get("/headshots", async (req, res) => {
	const raw = req.query.userIds;
	if (!raw) return res.status(400).json({ error: "No userIds" });
	const userIds = raw.split(",").map(id => id.trim()).filter(id => !isNaN(id));
	try {
		const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.join(",")}&size=150x150&format=Png&isCircular=false`;
		const response = await fetch(url, { headers: { "Accept": "application/json" } });
		if (!response.ok) return res.status(200).json({ data: [] });
		const data = await response.json();
		return res.status(200).json({ data: data.data || [] });
	} catch (err) {
		return res.status(500).json({ error: "Failed to fetch headshots" });
	}
});

app.get("/", (req, res) => res.send("Trade Limiteds API is running."));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
