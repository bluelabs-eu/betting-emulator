import fs from "node:fs";
import http from "node:http";
import readline from "node:readline";
import { URL } from "node:url";

// --- Config ---
const HOST = "127.0.0.1";
const PORT = 8011;
const RESPONSES_FILE = "./responses.json";

// CLI-controlled state
let postOption = 1;
let getOption = 1;

let responses: {
	[verb: string]: { status: number; response: unknown }[];
} = {};

function loadResponses() {
	const raw = fs.readFileSync(RESPONSES_FILE, "utf-8");
	responses = JSON.parse(raw);
}

loadResponses();

// CLI prompt setup
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function prompt() {
	rl.question(
		`(post [1..${responses.POST.length}] or get [1..${responses.GET.length}])? `,
		(answer: string) => {
			const [cmd, numStr] = answer.trim().split(/\s+/);
			const num = Number.parseInt(numStr, 10);
			if (cmd === "post" && num >= 1 && num <= responses.POST.length) {
				postOption = num;
				console.log(`POST responses now set to option ${postOption}`);
			} else if (cmd === "get" && num >= 1 && num <= responses.GET.length) {
				getOption = num;
				console.log(`GET responses now set to option ${getOption}`);
			} else if (cmd === "reload") {
				loadResponses();
			} else {
				console.log("Invalid command or out of range");
			}
			prompt();
		},
	);
}

function getResponse(verb: "GET" | "POST"): [number, unknown] {
	switch (verb) {
		case "POST": {
			const idx = postOption - 1;
			const { status, response } = responses.POST[idx];
			return [status, response];
		}
		case "GET": {
			const idx = getOption - 1;
			const { status, response } = responses.GET[idx];
			return [status, response];
		}
		default:
			throw new TypeError(`invalid verb ${verb}`);
	}
}

// HTTP server
const server = http.createServer((req, res) => {
	const url = new URL(req.url || "", `http://${req.headers.host}`);

	if (req.method === "POST" && url.pathname === "/tickets") {
		const [status, payload] = getResponse("POST");
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(payload));
		return;
	}

	if (req.method === "GET" && url.pathname.startsWith("/tickets/")) {
		const [status, payload] = getResponse("GET");
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(payload));
		return;
	}

	const proxyOpts = {
		hostname: "localhost",
		port: 8018,
		path: url.pathname + url.search, // preserve path + query
		method: req.method,
		headers: req.headers, // forward all headers
	};

	const proxyReq = http.request(proxyOpts, (proxyRes) => {
		// mirror status and headers from the target
		res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
		// pipe the body through
		proxyRes.pipe(res, { end: true });
	});

	proxyReq.on("error", (err) => {
		console.error("Proxy error:", err);
		res.writeHead(502, { "Content-Type": "text/plain" });
		res.end("Bad Gateway");
	});

	// pipe the incoming request body into the proxy
	req.pipe(proxyReq, { end: true });
});

server.listen(PORT, HOST, () => {
	console.log(`Server listening at http://${HOST}:${PORT}\n\n`);

	prompt();
});
