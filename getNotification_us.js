const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");

const dynamodb = new AWS.DynamoDB.DocumentClient();

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE; // Notifications_T
const JWT_SECRET = process.env.JWT_SECRET;

/* ---------- CORS RESPONSE HELPER ---------- */
const response = (statusCode, body = {}) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,PATCH"
  },
  body: JSON.stringify(body)
});

/* ---------- MAIN HANDLER ---------- */
exports.handler = async (event) => {
  const method =
    event.httpMethod ||
    event.requestContext?.http?.method;

  /* ---------- PREFLIGHT ---------- */
  if (method === "OPTIONS") {
    return response(200);
  }

  try {
    /* ---------- AUTH ---------- */
    const headers = event.headers || {};
    const authHeader =
      headers.authorization ||
      headers.Authorization ||
      headers.AUTHORIZATION;

    if (!authHeader) {
      return response(401, { message: "Authorization missing" });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return response(401, { message: "Invalid authorization format" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const userEmail = decoded.email;
    if (!userEmail) {
      return response(401, { message: "Invalid token payload" });
    }

    /* ---------- GET /notification ---------- */
    if (method === "GET") {
      const result = await dynamodb.query({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: "userEmail = :u",
        ExpressionAttributeValues: {
          ":u": userEmail
        },
        ScanIndexForward: false // latest first
      }).promise();

      const notifications = result.Items || [];
      const unreadCount = notifications.filter(n => !n.isRead).length;

      return response(200, {
        notifications,
        unreadCount
      });
    }

    /* ---------- PATCH /notification ---------- */
    if (method === "PATCH") {
      const result = await dynamodb.query({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: "userEmail = :u",
        ExpressionAttributeValues: {
          ":u": userEmail
        }
      }).promise();

      const unread = (result.Items || []).filter(n => !n.isRead);

      if (unread.length === 0) {
        return response(200, { message: "No unread notifications" });
      }

      const updates = unread.map(item =>
        dynamodb.update({
          TableName: NOTIFICATIONS_TABLE,
          Key: {
            userEmail: item.userEmail,
            createdAt: item.createdAt
          },
          UpdateExpression: "SET isRead = :true",
          ExpressionAttributeValues: {
            ":true": true
          }
        }).promise()
      );

      await Promise.all(updates);

      return response(200, {
        message: "All notifications marked as read"
      });
    }

    /* ---------- METHOD NOT ALLOWED ---------- */
    return response(405, { message: "Method not allowed" });

  } catch (error) {
    console.error("NOTIFICATION ERROR:", error);
    return response(401, { message: "Unauthorized" });
  }
};