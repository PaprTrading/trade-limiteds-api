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
		// Step 1: Get all collectibles (limiteds) from inventory
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
			const saleStatus = {};

			// Step 2: Batch fetch thumbnails
			for (let i = 0; i < assetIds.length; i += 100) {
				const batch = assetIds.slice(i, i + 100).join(",");
				try {
					const thumbRes = await fetch(
						`https://thumbnails.roblox.com/v1/assets?assetIds=${batch}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`,
						{ headers: { "Accept": "application/json" } }
					);
					if (thumbRes.ok) {
						const thumbData = await thumbRes.json();
						for (const t of (thumbData.data || [])) {
							thumbnails[t.targetId] = t.imageUrl;
						}
					}
				} catch (e) {}
			}

			// Step 3: Batch fetch asset sale details using economy API
			// This returns priceStatus which is the most reliable offsale indicator
			for (let i = 0; i < assetIds.length; i += 100) {
				const batch = assetIds.slice(i, i + 100);
				try {
					// Fetch each asset's economy data
					const promises = batch.map(id =>
						fetch(`https://economy.roblox.com/v2/assets/${id}/details`, {
							headers: { "Accept": "application/json" }
						}).then(r => r.ok ? r.json() : null).catch(() => null)
					);
					const results = await Promise.all(promises);
					for (const asset of results) {
						if (!asset) continue;
						// priceStatus "Off Sale" or "No Resellers" means offsale
						// isForSale false and price is null means offsale
						const isOffsale =
							asset.PriceStatus === "Off Sale" ||
							asset.priceStatus === "Off Sale" ||
							(!asset.IsForSale && !asset.isForSale && asset.PriceInRobux === null && asset.priceInRobux === null) ||
							asset.Sales === 0 && !asset.IsForSale;

						saleStatus[asset.AssetId || asset.assetId] = {
							isOffsale: isOffsale,
							originalPrice: asset.PriceInRobux || asset.priceInRobux || 0,
						};
					}
				} catch (e) {}
			}

			const itemDetails = allItems.map(item => {
				const status = saleStatus[item.assetId] || {};
				return {
					assetId: item.assetId,
					name: item.name,
					rap: item.recentAveragePrice || 0,
					originalPrice: status.originalPrice || 0,
					isOffsale: status.isOffsale || false,
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
// Returns avatar headshot URLs for a list of userIds
// ============================================================

app.get("/headshots", async (req, res) => {
	const raw = req.query.userIds;
	if (!raw) return res.status(400).json({ error: "No userIds" });

	const userIds = raw.split(",").map(id => id.trim()).filter(id => !isNaN(id));
	if (userIds.length === 0) return res.status(400).json({ error: "Invalid userIds" });

	try {
		const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.join(",")}&size=150x150&format=Png&isCircular=false`;
		const response = await fetch(url, { headers: { "Accept": "application/json" } });

		if (!response.ok) return res.status(200).json({ data: [] });

		const data = await response.json();
		return res.status(200).json({ data: data.data || [] });
	} catch (err) {
		console.error("Headshot error:", err);
		return res.status(500).json({ error: "Failed to fetch headshots" });
	}
});

app.get("/", (req, res) => res.send("Trade Limiteds API is running."));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
