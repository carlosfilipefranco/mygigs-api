// Limite por utilizador e por processo; não guarda tokens nem conteúdo dos pedidos.
module.exports = function requestLimit({ max, windowMs }) {
	const buckets = new Map();
	return (req, res, next) => {
		const now = Date.now();
		if (buckets.size >= 1000) {
			for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
		}
		const key = String(req.user.id);
		let bucket = buckets.get(key);
		if (!bucket || bucket.resetAt <= now) {
			if (buckets.size >= 10000 && !bucket) return res.status(503).json({ message: "Tenta novamente mais tarde." });
			bucket = { count: 0, resetAt: now + windowMs };
			buckets.set(key, bucket);
		}
		if (++bucket.count > max) {
			res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
			return res.status(429).json({ message: "Limite de pedidos atingido. Tenta novamente mais tarde." });
		}
		next();
	};
};
