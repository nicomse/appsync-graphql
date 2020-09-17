const AWS = require('aws-sdk');
const https = require('https');

// Fix for serverless offline
AWS.NodeHttpClient.sslAgent = new https.Agent({ rejectUnauthorized: false });

const Utils = require('./utils');

const $ddb = Utils.getDynamo();
const $socket = Utils.getSocketApi();

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

async function markAsRead(request, context) {
	const user = await Utils.getItem(USERS_TABLE, { id: request.pathParameters.userId });
	const notifications = (user.notifications || []).map(notification => {
		if (notification.notificationId == request.pathParameters.notificationId) {
			notification.fresh = false;
		}

		return notification;
	});

	await $ddb.update({
		TableName: USERS_TABLE,
		Key: {
			id: request.pathParameters.userId
		},
		ReturnValues: 'ALL_NEW',
		UpdateExpression: 'set #notifications = :notifications',
			ExpressionAttributeNames: {
				'#notifications': 'notifications'
			},
			ExpressionAttributeValues: {
				':notifications': notifications
			}
	}).promise();

	return { statusCode: 200 };
}

async function getNotifications(userId) {
	const user = await Utils.getItem(USERS_TABLE, { id: userId });

	if (!user.notifications) {
		return [];
	}

	return Promise.all(user.notifications.map(async notification => {
		const body = await getNotification(notification.notificationId);

		return {...body, fresh: notification.fresh };
	}));
}

async function getUnreadNotifications(userId) {
	const user = await Utils.getItem(USERS_TABLE, { id: userId });

	if (!user.notifications) {
		return [];
	}

	return Promise.all(
		user.notifications
			.filter(notification => notification.fresh === true)
			.map(notification => getNotification(notification.notificationId))
	);
}

async function getNotification(notificationId) {
	return Utils.getItem(NOTIFICATIONS_TABLE, { notificationId });
}

async function sendNotification(userId, notification, channel = 'socket') {
	if (channel === 'socket') {
		await pushNotification(userId, notification);
	}
	return { statusCode: 200 };
}

async function pushNotification(userId, notification) {
	const connections = await Utils.scanTable(CONNECTIONS_TABLE);
	const connection = connections.find(socket => socket.userId === userId);

	// Save notification in users table
	await saveUnreadNotification(userId, notification);

	if (!connection) {
		return;
	}

	return $socket.postToConnection({
		ConnectionId: connection.connectionId,
		Data: JSON.stringify({...notification, fresh: true})
	})
	.promise()
	.catch(err => {
		// If connection is stale, catch error and remove it from table
		if (err.statusCode === 410 || err.statusCode === 404) {
			return $ddb.delete({
				TableName: CONNECTIONS_TABLE,
				Key: {
					connectionId: connection.connectionId
				}
			}).promise();
		}

		throw err;
	});
}

async function saveUnreadNotification(userId, notification) {
	return $ddb.update({
		TableName: USERS_TABLE,
		Key: {
			id: userId
		},
		ReturnValues: 'ALL_NEW',
		UpdateExpression: 'set #notifications = list_append(if_not_exists(#notifications, :empty_list), :notification)',
			ExpressionAttributeNames: {
				'#notifications': 'notifications'
			},
			ExpressionAttributeValues: {
				':notification': [{ notificationId: notification.notificationId, fresh: true }],
				':empty_list': []
			}
		}).promise();
}

module.exports = { sendNotification, getNotification, getNotifications, getUnreadNotifications, markAsRead, pushNotification };